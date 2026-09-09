/**
 * RAG 서비스 (키워드 검색 + 근거 기반 답변).
 *
 * 1) retrieve: 발화를 토큰화해 컬렉션 청크와 키워드/본문 겹침으로 점수화 → 상위 K개.
 * 2) answer: 검색된 청크를 컨텍스트로 LLM에 넣어, 문서 근거로만 답하게 한다.
 */
import type { LlmClient } from '../../llm/llm.types'
import type { RagChunk } from './rag.docs'
import type { ChatTurn, RagScoreEntry } from '../pipeline.types'
import { getPromptStore } from '../../features/chat/service/prompt-store.service'
import { CHAT_PROMPT_TYPE } from '../../features/chat/prompt-types'
import { logLlmPromptMeta, safeJsonParse } from '../../utils/utils'

/** 한글/영문/숫자 토큰 추출(2글자 이상). */
function tokenize(text: string): string[] {
  const lower = String(text ?? '').toLowerCase()
  const matched = lower.match(/[가-힣a-z0-9]+/g) ?? []
  return matched.filter((t) => t.length >= 2)
}

function scoreChunk(chunk: RagChunk, queryTokens: string[], rawQuery: string): number {
  const q = rawQuery.toLowerCase()
  let score = 0
  const isAsciiToken = (value: string) => /^[a-z0-9]+$/.test(value)
  const tokenLooselyMatches = (left: string, right: string): boolean => {
    if (!left || !right) return false
    if (left === right) return true

    // ASCII 토큰(예: ifthen vs ifthenelse)은 부분 일치로 보지 않는다.
    if (isAsciiToken(left) && isAsciiToken(right) && left.length >= 4 && right.length >= 4) {
      return false
    }

    return left.includes(right) || right.includes(left)
  }

  const keywordTokenLooselyMatches = (keyword: string): boolean => {
    const keywordTokens = tokenize(keyword)
    if (keywordTokens.length === 0) return false

    return queryTokens.some((queryToken) => keywordTokens.some((keywordToken) => {
      return tokenLooselyMatches(queryToken, keywordToken)
    }))
  }

  // 키워드 정확/부분 매칭 (가중치 높음)
  for (const kw of chunk.keywords) {
    const k = kw.toLowerCase()
    if (q.includes(k)) score += 3
    else if (keywordTokenLooselyMatches(k)) score += 1.5
  }

  // 제목/본문 토큰 겹침(정확 토큰 기준)
  const haystackTokens = new Set(tokenize(`${chunk.title} ${chunk.body}`))
  for (const t of queryTokens) {
    if (haystackTokens.has(t)) {
      score += 0.5
      continue
    }

    const hasLooseHit = Array.from(haystackTokens).some((haystackToken) => tokenLooselyMatches(t, haystackToken))
    if (hasLooseHit) score += 0.25
  }
  return score
}

export type RetrievedChunk = { chunk: RagChunk; score: number }
export type RagIntentType = 'info' | 'action'
export type RagLogger = {
  log: (msg: string) => void
  error: (msg: string) => void
  debug?: (msg: string) => void
}

export type RagSelectionConfig = {
  topK: number
  minScore: number
  screenBonus: number
}

type RagCollectionEval = {
  collection: string
  hits: RetrievedChunk[]
  topScore: number
  adjustedScore: number
  hitCount: number
  topChunks: Array<{ chunkKey: string; title?: string; finalScore: number; rawScore: number }>
  topChunkIds: string[]
  relaxed: boolean
}

export class RagService {
  constructor(
    private readonly client: LlmClient,
    private readonly maxOutputTokens: number,
    private readonly selection: RagSelectionConfig,
    private readonly logger: RagLogger,
  ) { }

  private getRagPrompt(intentType?: RagIntentType) {
    const promptType = intentType === 'action' ? CHAT_PROMPT_TYPE.ragAction : CHAT_PROMPT_TYPE.ragInfo
    const meta = getPromptStore()?.getPromptMeta('common', promptType)
    return { promptType, meta, prompt: meta?.enabled === false ? '' : meta?.prompt ?? '' }
  }

  private readRagResponseText(value: string | undefined): string {
    const parsed = safeJsonParse(String(value ?? '').trim()) as Record<string, unknown> | null
    return typeof parsed?.text === 'string' ? parsed.text.trim() : ''
  }

  private copiesDocumentText(answer: string, documentBodies: string[]): boolean {
    const answerComparable = String(answer ?? '').replace(/\s+/g, '').trim()
    if (!answerComparable) return false

    return documentBodies.some((body) => {
      const bodyComparable = String(body ?? '').replace(/\s+/g, '').trim()
      return bodyComparable.length > 0 && answerComparable === bodyComparable
    })
  }

  private async generateRagResponse(
    system: string,
    message: string,
    history: ChatTurn[],
    documentBodies: string[],
    reqId: string,
  ): Promise<string> {
    const documentLength = documentBodies.reduce(
      (total, body) => total + String(body ?? '').length,
      0,
    )
    const historyLength = history.reduce(
      (total, turn) => total + String(turn.content ?? '').length,
      0,
    )
    const messageLength = String(message ?? '').length
    const totalRequestLength = system.length + historyLength + messageLength
    console.warn(
      `[rag-answer] [reqId=${reqId}] requestLength=${totalRequestLength} systemLength=${system.length} documentLength=${documentLength} documentCount=${documentBodies.length} historyLength=${historyLength} messageLength=${messageLength}`,
    )
    const first = await this.client.generateContent({
      messages: [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
      ],
      maxOutputTokens: this.maxOutputTokens,
    })
    const firstText = this.readRagResponseText(first.text)
    if (firstText && !this.copiesDocumentText(firstText, documentBodies)) return firstText

    const retryInstruction = '이전 응답 형식이 올바르지 않습니다. RAG 프롬프트의 최종 JSON 형식만 사용해 다시 답변하세요.'
    console.warn(
      `[rag-answer] [reqId=${reqId}] retrying reason=${firstText ? 'verbatim-document-text' : 'invalid-json-response'} retryRequestLength=${totalRequestLength + String(first.text ?? '').length + retryInstruction.length} previousResponseLength=${String(first.text ?? '').length}`,
    )

    const retry = await this.client.generateContent({
      messages: [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
        { role: 'assistant', content: first.text ?? '' },
        { role: 'user', content: retryInstruction },
      ],
      maxOutputTokens: this.maxOutputTokens,
    })
    const retryText = this.readRagResponseText(retry.text)
    if (retryText && !this.copiesDocumentText(retryText, documentBodies)) return retryText

    console.warn(`[rag-answer] [reqId=${reqId}] rejected reason=${retryText ? 'verbatim-document-text' : 'invalid-json-response'}`)
    return ''
  }

  private stageLog(stage: string, status: string, reason: string, reqId = '-') {
    void stage
    void status
    void reason
    void reqId
  }

  private resolveCollection(collectionName: string): { chunks: RagChunk[] } | undefined {
    const dbCollection = getPromptStore()?.getCollection(collectionName)
    if (dbCollection) {
      return {
        chunks: dbCollection.chunks.map((chunk) => ({
          id: chunk.id,
          title: chunk.title,
          keywords: chunk.keywords,
          body: chunk.body,
          intentType: (chunk.intentType ?? 'both') as RagIntentType | 'both',
        })),
      }
    }

    return undefined
  }

  private supportsIntent(chunk: RagChunk, intentType?: RagIntentType): boolean {
    if (!intentType) return true

    const raw = String((chunk as any).intentType ?? '').trim().toLowerCase()
    if (!raw || raw === 'both') return true
    return raw === intentType
  }

  retrieve(collectionName: string, query: string, intentType?: RagIntentType): RetrievedChunk[] {
    const collection = this.resolveCollection(collectionName)
    if (!collection) return []

    const tokens = tokenize(query)
    return collection.chunks
      .filter((chunk) => this.supportsIntent(chunk, intentType))
      .map((chunk) => ({ chunk, score: scoreChunk(chunk, tokens, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.selection.topK)
  }

  scoreCollections(collectionNames: string | string[], query: string, intentType?: RagIntentType): RagScoreEntry[] {
    const names = Array.isArray(collectionNames) ? collectionNames : [collectionNames]
    const evaluated = names
      .map((name) => this.evaluateCollection(name, query, intentType))
      .filter((item): item is RagCollectionEval => Boolean(item))

    const result = evaluated
      .map((item) => ({
        collection: item.collection,
        topScore: item.topScore,
        adjustedScore: item.adjustedScore,
        hitCount: item.hitCount,
        topChunks: item.topChunks,
        topChunkIds: item.topChunkIds,
        relaxed: item.relaxed,
      }))
      .filter((entry): entry is RagScoreEntry => Boolean(entry && entry.collection))

    if (this.logger?.log) {
      const comparison = result
        .map((entry) => {
          const collection = String(entry.collection ?? '-').trim() || '-'
          const topScore = Number(entry.topScore ?? 0)
          const adjustedScore = Number(entry.adjustedScore ?? 0)
          const hitCount = Number(entry.hitCount ?? 0)
          return `${collection}={top:${topScore.toFixed(2)}, adjusted:${adjustedScore.toFixed(2)}, hits:${hitCount}}`
        })
        .join(' | ')

      this.logger.log(
        `[ragService] scoreCollections query="${String(query ?? '').slice(0, 200)}" intent=${intentType ?? 'all'} collections=[${names.join(', ')}] comparison=${comparison || 'none'}`,
      )
    }

    return result
  }

  private evaluateCollection(collectionName: string, query: string, intentType?: RagIntentType): RagCollectionEval | null {
    const resolvedCollection = this.resolveCollection(collectionName)
    const hits = this.retrieve(collectionName, query, intentType)
    const relaxed = false

    const topScore = hits[0]?.score ?? 0
    const collectionBonus = collectionName === 'common' ? 0 : this.selection.screenBonus
    const adjustedScore = topScore + collectionBonus
    const topChunks = hits.slice(0, this.selection.topK).map((row) => ({
      chunkKey: row.chunk.id,
      title: String(row.chunk.title ?? '').trim() || undefined,
      finalScore: row.score + collectionBonus,
      rawScore: row.score,
    }))

    if (!resolvedCollection && hits.length === 0) {
      return {
        collection: collectionName,
        hits: [],
        topScore: 0,
        adjustedScore: collectionBonus,
        hitCount: 0,
        topChunks: [],
        topChunkIds: [],
        relaxed,
      }
    }

    return {
      collection: collectionName,
      hits,
      topScore,
      adjustedScore,
      hitCount: hits.length,
      topChunks,
      topChunkIds: hits.slice(0, this.selection.topK).map((row) => row.chunk.id),
      relaxed,
    }
  }

  private findChunkByIdInCollection(
    collectionName: string,
    chunkId: string,
    intentType?: RagIntentType,
  ): { collection: string; chunk: RagChunk } | null {
    const collection = this.resolveCollection(collectionName)
    if (!collection) return null

    const targetId = String(chunkId ?? '').trim()
    if (!targetId) return null

    const found = collection.chunks.find((chunk) => {
      if (chunk.id !== targetId) return false
      return this.supportsIntent(chunk, intentType)
    })

    if (!found) return null
    return { collection: collectionName, chunk: found }
  }

  private resolveChunksByIds(
    collectionNames: string[],
    chunkIds: string[],
    intentType?: RagIntentType,
  ): Array<{ collection: string; chunk: RagChunk }> {
    const results: Array<{ collection: string; chunk: RagChunk }> = []
    const seenChunkIds = new Set<string>()

    for (const rawChunkId of chunkIds) {
      const chunkId = String(rawChunkId ?? '').trim()
      if (!chunkId || seenChunkIds.has(chunkId)) continue

      for (const collectionName of collectionNames) {
        const matched = this.findChunkByIdInCollection(collectionName, chunkId, intentType)
        if (!matched) continue

        seenChunkIds.add(chunkId)
        results.push(matched)
        break
      }
    }

    return results
  }

  private collectIntentChunks(
    collectionNames: string[],
    intentType?: RagIntentType,
  ): Array<{ collection: string; chunk: RagChunk }> {
    const results: Array<{ collection: string; chunk: RagChunk }> = []
    const seenChunkIds = new Set<string>()

    for (const collectionName of collectionNames) {
      const collection = this.resolveCollection(collectionName)
      if (!collection) continue

      for (const chunk of collection.chunks) {
        const chunkId = String(chunk.id ?? '').trim()
        if (!chunkId || seenChunkIds.has(chunkId) || !this.supportsIntent(chunk, intentType)) continue
        seenChunkIds.add(chunkId)
        results.push({ collection: collectionName, chunk })
      }
    }

    return results
  }

  async answerFromChunkKeys(
    collectionNames: string | string[],
    chunkKeys: string[],
    message: string,
    history: ChatTurn[] = [],
    reqId = '-',
    options?: { intentType?: RagIntentType; appKey?: string; screenKey?: string },
  ): Promise<{ text: string; usedCollection?: string; primaryChunkKey?: string; usedChunks: string[]; ragScores: RagScoreEntry[] }> {
    const names = Array.isArray(collectionNames) ? collectionNames : [collectionNames]
    const targetChunkKeys = Array.from(new Set(chunkKeys.map((k) => String(k ?? '').trim()).filter(Boolean)))
    if (targetChunkKeys.length === 0) {
      return { text: '', usedChunks: [], ragScores: [] }
    }

    const matchedChunks = this.resolveChunksByIds(names, targetChunkKeys, options?.intentType)

    if (matchedChunks.length === 0) {
      return { text: '', usedChunks: [], ragScores: [] }
    }

    const usedChunkIds = matchedChunks.map((row) => row.chunk.id)
    const primaryChunkKey = usedChunkIds[0]
    const uniqueCollections = Array.from(new Set(matchedChunks.map((row) => row.collection)))
    const usedCollection = uniqueCollections.length === 1 ? uniqueCollections[0] : uniqueCollections[0]

    const context = matchedChunks
      .map((row, i) => `[문서 ${i + 1}] ${row.chunk.title}\n${row.chunk.body}`)
      .join('\n\n')

    const promptStore = getPromptStore()
    const { promptType, meta: commonRagMeta, prompt: commonRag } = this.getRagPrompt(options?.intentType)
    // instruction 은 common -> 앱 -> 화면 순으로 합친다.
    const instructionSources = promptStore?.describeInstructionSources(options?.appKey, options?.screenKey) ?? '-'
    const commonInstruction = promptStore?.getInstruction(options?.appKey, options?.screenKey) ?? ''
    const system = [commonInstruction, commonRag, context].filter(Boolean).join('\n\n')

    this.logger.log?.(
      `================= [3-3-2단계:RAG_청크강제폴백] [reqId=${reqId}] chunkKeys=${JSON.stringify(targetChunkKeys)} matchedChunks=${JSON.stringify(usedChunkIds)} collections=${JSON.stringify(uniqueCollections)}`,
    )
    this.logger.log(
      `######## 적용 프롬프트 아이디 ########\n[reqId=${reqId}] [stage=rag-answer-from-chunk-keys]\n- instruction(common+app+screen): ${instructionSources}\n- common/${promptType}: ${commonRagMeta?.id ?? '-'}\n######################################`,
    )

    logLlmPromptMeta({
      stage: 'rag-answer-from-chunk-keys',
      promptType,
      route: usedCollection ?? null,
      appKey: String(usedCollection ?? '').split('/').filter(Boolean)[0] || null,
      promptId: commonRagMeta?.id ?? null,
      systemPromptLen: system.length,
      messageLen: String(message ?? '').length,
      historyTurns: history.length,
      toolCount: 0,
      isToolCall: false,
      reqId,
    })

    const text = await this.generateRagResponse(
      system,
      message,
      history,
      matchedChunks.map((row) => row.chunk.body),
      reqId,
    )
    return {
      text,
      usedCollection,
      primaryChunkKey,
      usedChunks: usedChunkIds,
      ragScores: [],
    }
  }

  /**
   * 문서 근거로 답변.
  * 현재 화면/앱 및 공통 범위의 해당 인텐트 문서를 모두 LLM에 전달한다.
   */
  async answer(
    collectionNames: string | string[],
    message: string,
    history: ChatTurn[] = [],
    reqId = '-',
    options?: { intentType?: RagIntentType; appKey?: string; screenKey?: string },
  ): Promise<{ text: string; usedCollection?: string; primaryChunkKey?: string; usedChunks: string[]; ragScores: RagScoreEntry[] }> {
    const names = Array.isArray(collectionNames) ? collectionNames : [collectionNames]
    const intentLabel = options?.intentType ?? 'all'

    this.stageLog('3-1단계:RAG_컬렉션후보', 'loaded', `후보 컬렉션 ${names.length}개를 순차 탐색`, reqId)
    this.logger.log?.(
      `================= [3-1단계:RAG_컬렉션후보_추적] [reqId=${reqId}] names=${JSON.stringify(names)} messageLen=${String(message ?? '').length} historyTurns=${history.length}`,
    )
    const matchedChunks = this.collectIntentChunks(names, options?.intentType)
    if (matchedChunks.length === 0) {
      this.stageLog('3-3단계:RAG_탐색결과', 'empty', '해당 인텐트의 활성 RAG 문서 없음', reqId)
      return { text: '', usedChunks: [], ragScores: [] }
    }

    const usedCollection = matchedChunks[0]?.collection
    const primaryChunkKey = matchedChunks[0]?.chunk.id
    const usedChunkIds = matchedChunks.map((row) => row.chunk.id)
    const referencedChunks = matchedChunks.map((row) => `${row.chunk.id}:${row.chunk.title}`).join(', ')
    this.logger.log(
      `================= [3-3-1단계:RAG_참조청크] [reqId=${reqId}] status=selected reason=all-documents intent=${intentLabel} collections=${JSON.stringify(names)} referencedChunks=[${referencedChunks}]`,
    )

    const context = matchedChunks
      .map((row, index) => `[문서 ${index + 1}] ${row.chunk.title}\n${row.chunk.body}`)
      .join('\n\n')

    const promptStore = getPromptStore()
    const { promptType, meta: commonRagMeta, prompt: commonRag } = this.getRagPrompt(options?.intentType)
    // instruction 은 common -> 앱 -> 화면 순으로 합친다.
    const instructionSources = promptStore?.describeInstructionSources(options?.appKey, options?.screenKey) ?? '-'
    const commonInstruction = promptStore?.getInstruction(options?.appKey, options?.screenKey) ?? ''

    const ragSystem = context

    const system = [commonInstruction, commonRag, ragSystem].filter(Boolean).join('\n\n')

    this.stageLog(
      '3-4단계:RAG_프롬프트생성',
      'ready',
      `전체 범위 문서 ${matchedChunks.length}개로 프롬프트 구성`,
      reqId,
    )
    this.logger.log?.(
      `================= [3-4단계:RAG_프롬프트생성_추적] [reqId=${reqId}] commonInstructionApplied=${Boolean(commonInstruction)} systemLen=${system.length}`,
    )
    this.logger.log(
      `######## 적용 프롬프트 아이디 ########\n[reqId=${reqId}] [stage=rag-answer]\n- instruction(common+app+screen): ${instructionSources}\n- common/${promptType}: ${commonRagMeta?.id ?? '-'}\n######################################`,
    )
    this.logger.log(
      `[rag-diagnosis] [reqId=${reqId}] stage=prompt instructionSources=${instructionSources} ${promptType}PromptId=${commonRagMeta?.id ?? '-'} message=${JSON.stringify(message)} selectedChunks=${JSON.stringify(matchedChunks.map((row) => ({ collection: row.collection, id: row.chunk.id, title: row.chunk.title, body: row.chunk.body })))} commonInstruction=${JSON.stringify(commonInstruction)} ragPrompt=${JSON.stringify(commonRag)} system=${JSON.stringify(system)}`,
    )

    // this.logger.log(`[ragService] system ${system}`)

    logLlmPromptMeta({
      stage: 'rag-answer',
      promptType,
      route: usedCollection ?? null,
      appKey: String(usedCollection ?? '').split('/').filter(Boolean)[0] || null,
      promptId: commonRagMeta?.id ?? null,
      systemPromptLen: system.length,
      messageLen: String(message ?? '').length,
      historyTurns: history.length,
      toolCount: 0,
      isToolCall: false,
      reqId,
    })

    const text = await this.generateRagResponse(
      system,
      message,
      history,
      matchedChunks.map((row) => row.chunk.body),
      reqId,
    )
    this.stageLog(
      '3-6단계:RAG_응답생성완료',
      text ? 'completed' : 'empty',
      `collection=${usedCollection ?? '-'} 응답 생성 완료`,
      reqId,
    )
    this.logger.log(
      `================= [3-6-1단계:RAG_참조청크_최종] [reqId=${reqId}] status=used reason=all-documents usedChunkIds=[${usedChunkIds.join(', ')}]`,
    )
    this.logger.log?.(
      `================= [3-6단계:RAG_응답생성완료_추적] [reqId=${reqId}] textLength=${text.length} usedChunks=${JSON.stringify(usedChunkIds)}`,
    )
    this.logger.log(
      `[rag-diagnosis] [reqId=${reqId}] stage=llm-response text=${JSON.stringify(text)}`,
    )
    return {
      text,
      usedCollection,
      primaryChunkKey,
      usedChunks: usedChunkIds,
      ragScores: [],
    }
  }
}
