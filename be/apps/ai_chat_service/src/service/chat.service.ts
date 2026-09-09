/**
 * 챗봇 진입 서비스.
 *
 * 처리 순서:
 * 1. 현재 화면(routeKey) 확정
 * 2. 화면별 handler 선택
 * 3. 해당 화면 안에서 intent 분류
 * 4. 화면별 pipeline/orchestrator 처리
 * 5. 실패/미등록 화면이면 guidance 정적 안내 폴백
 * 6. 모든 응답은 chat_log 에 저장
 */
import { Injectable, Logger } from '@nestjs/common'

import { getDefaultLlmProvider } from '../llm/llm.factory'
import type { LlmProvider, LlmRuntime } from '../llm/llm.types'
import { ChatLogService } from '../features/chat-settings/db/chat-log.service'
import { ChatSettingService } from '../features/chat-settings/service/chat-setting.service'
import { getPromptStore, type RagChunkData } from '../features/chat/service/prompt-store.service'
import { CHAT_PROMPT_TYPE } from '../features/chat/prompt-types'
import { ChatOrchestrator } from '../pipeline/chat.orchestrator'
import { loadChatPipelineConfig } from '../pipeline/pipeline.config'
import { safeJsonParse } from '../utils/utils'
import { findNearestRegisteredRouteKey } from './route-match.util'
import {
  ensurePeriodInEventReply,
  ensureUserFacingReply,
  isInfoPipelineReply,
  toDisplayText,
} from './reply-text.util'
import type { ChatReply, ChatReplyImage, ChatTurn, SuggestedAction } from '../pipeline/pipeline.types'
import {
  includesConfiguredPhrase,
  loadTaskflowClassifierRules,
  loadTaskflowLanguageRules,
  type TaskflowClassifierRules,
} from '../pipeline/taskflow-language-rules'
import {
  findContentRef,
  findGraphNodes,
  parseNodeTarget,
  readCurrentGraphFromContext,
  readTaskContentsFromContext,
  resolveTaskAlias,
} from '../pipeline/tools/taskflow-palette'
import { getPropertyTmsStore } from '../features/taskflow/service/property-tms-store.service'
import { getScreenConfig } from '../pipeline/screen-registry'
import type { ToolDefinition } from '../pipeline/tool.type'
import { buildToolContextFromBody } from '../pipeline/tool-context.util'
import { queryEvents } from '../screens/robot/ailog-event.datatools'
import { matchFrontRule, type FrontRuleMatch } from '../domains/front-rule/front-rule-engine'
import { ChatRuleService } from '../features/chat-settings/db/chat-rule.service'
import type { MatchedRuleInfo } from '../pipeline/pipeline.types'
import { markFlowDecision, readFlowTrace, recordFlowStep, resetFlowTrace, type ChatFlowTrace } from '../pipeline/flow-trace'

type RuntimeEntry = {
  llm: LlmRuntime
  orchestrator: ChatOrchestrator
}

type ChatContext = {
  body: any
  reqId: string
  llm: LlmRuntime
  orchestrator: ChatOrchestrator
  startedAt: number
  author: string
  conversationId: string
  message: string
  currentApp: string
  currentPath: string
  key: string
  history: ChatTurn[]
  taskflowClassifierRules: TaskflowClassifierRules
}

type ChatLogDebugMeta = {
  reqId?: string
  pipelineIntent?: string
  pipelineConfidence?: number
  pipelineTrace?: string
  screenTask?: string
  defaultLlmFallback?: boolean
  llmAttempted?: boolean
  infoTextMissing?: boolean
  emptyTextReason?: string
  suggestedActionsAttached?: boolean
  ragMatchScore?: number
  ragAdjustedScore?: number
  ragThresholdScore?: number
  ragMinScore?: number
  ragSelectionRule?: string
  usedCollection?: string
  actionRagCollection?: string
  primaryChunkKey?: string
  usedChunks?: string[]
  actionRagChunks?: string[]
  ragScores?: unknown[]
  executed?: unknown[]
  fallbackReason?: string
  /** 가이드 문구로 덮어쓴 모델 답변. tool 을 왜 안 불렀는지 추적하는 단서다. */
  discardedText?: string
  loginUser?: {
    userId?: string
    userName?: string
    userEmail?: string
    accountId?: string
  }
  source?: 'orchestrator' | 'rule-first' | 'guidance' | 'front-rule'
  matchedRule?: MatchedRuleInfo
  /** 요청이 지나온 모든 단계. 채팅 내역 디버그 패널이 이 값을 그린다. */
  flowTrace?: ChatFlowTrace
}

type ScreenSummary = {
  appKey: string
  key: string
  screenName: string
}

type ScreenTask =
  | 'unknown'
  | 'guide'
  | 'list'
  | 'search'
  | 'summary'
  | 'analyze'
  | 'recommend_action'
  | 'run_action'
  | 'settings'
  | 'create'
  | 'update'
  | 'delete'

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)
  private readonly pipelineCfg = loadChatPipelineConfig()

  private readonly runtimeCache = new Map<string, RuntimeEntry>()

  constructor(
    private readonly chatLog: ChatLogService,
    private readonly chatSetting: ChatSettingService,
    private readonly chatRules: ChatRuleService,
  ) {
    this.silenceVerboseLogs()
  }

  private silenceVerboseLogs() {
    ;(this.logger as unknown as { log: (...args: any[]) => void }).log = () => undefined
    ;(this.logger as unknown as { debug: (...args: any[]) => void }).debug = () => undefined
  }

  /** 콘솔로는 남기지 않되, 채팅 내역에 보여 줄 흐름 기록에는 단계별로 쌓는다. */
  private stageLog(stage: string, status: string, reason: string, reqId?: string) {
    recordFlowStep(reqId, stage, {
      ...(status ? { status } : {}),
      ...(reason ? { reason } : {}),
    })
  }

  private normalizeRuleConfidence(value: number | string | undefined): number | undefined {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private getRuleCaptures(ruleMatch: FrontRuleMatch): string[] {
    return Array.isArray(ruleMatch.captures)
      ? ruleMatch.captures.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
  }

  private emitCompactPipelineWarnLogs(ctx: ChatContext, meta: Record<string, unknown> | undefined, reply: ChatReply) {
    const reqId = String(ctx.reqId ?? '-').trim() || '-'
    const intent = String(meta?.pipelineIntent ?? 'unknown').trim().toLowerCase() || 'unknown'

    this.logger.warn(`[chatSiteAssitant] [1단계:인텐트] [reqId=${reqId}] intent=${intent}`)

    const ragScores = Array.isArray(reply.ragScores) ? reply.ragScores : []
    if (intent === 'info' || ragScores.length > 0) {
      const common = ragScores.find((item) => String(item.collection) === 'common')
      const screenBest = ragScores
        .filter((item) => String(item.collection) !== 'common')
        .sort((a, b) => Number(b.adjustedScore ?? 0) - Number(a.adjustedScore ?? 0))[0]

      const commonScore = common ? Number(common.adjustedScore ?? common.topScore ?? 0).toFixed(2) : '-'
      const screenScore = screenBest ? Number(screenBest.adjustedScore ?? screenBest.topScore ?? 0).toFixed(2) : '-'
      const screenCollection = screenBest?.collection ?? '-'
      const usedCollection = String(reply.usedCollection ?? '-').trim() || '-'
      const selected = ragScores.find((item) => String(item.collection) === usedCollection)
      const selectedScore = selected ? Number(selected.topScore ?? 0).toFixed(2) : '-'
      const selectedAdjustedScore = selected ? Number(selected.adjustedScore ?? selected.topScore ?? 0).toFixed(2) : '-'
      const threshold = Number(this.pipelineCfg.infoRagMinScore ?? 0).toFixed(2)
      const comparisonSummary = ragScores
        .map((item) => {
          const collection = String(item.collection ?? '-').trim() || '-'
          const topScore = Number(item.topScore ?? 0).toFixed(2)
          const adjustedScore = Number(item.adjustedScore ?? 0).toFixed(2)
          const hits = Number(item.hitCount ?? 0)
          const chunkDetails = Array.isArray(item.topChunks) && item.topChunks.length > 0
            ? item.topChunks
                .map((chunk) => {
                  const chunkKey = String(chunk?.chunkKey ?? '').trim() || '-'
                  const title = String(chunk?.title ?? '').trim()
                  const finalScore = Number(chunk?.finalScore ?? 0).toFixed(2)
                  const rawScore = Number(chunk?.rawScore ?? 0).toFixed(2)
                  const titleSuffix = title ? `, title=${title}` : ''
                  return `${chunkKey}(final=${finalScore}, raw=${rawScore}${titleSuffix})`
                })
                .join('; ')
            : '[]'
          return `${collection}(top=${topScore}, adjusted=${adjustedScore}, hits=${hits}, topChunks=[${chunkDetails}])`
        })
        .join(' | ') || 'none'

      const selectedChunkSummary = Array.isArray(reply.usedChunks) && reply.usedChunks.length > 0
        ? reply.usedChunks
            .map((chunkId) => String(chunkId ?? '').trim())
            .filter(Boolean)
            .join(', ')
        : 'none'

      this.logger.warn(
        `[chatSiteAssitant] [2단계:RAG점수] [reqId=${reqId}] matchScore=${selectedScore} adjustedScore=${selectedAdjustedScore} thresholdScore=${threshold} selected=${usedCollection} selectedChunks=[${selectedChunkSummary}] comparison=${comparisonSummary} common=${commonScore} screen(${screenCollection})=${screenScore}`,
      )
    }

    if (intent === 'action') {
      const executed = Array.isArray(meta?.executed) ? (meta?.executed as Array<Record<string, unknown>>) : []
      const summary = executed.length > 0
        ? executed
            .map((row) => {
              const name = String(row.name ?? '-').trim() || '-'
              const err = String(row.error ?? '').trim()
              return err ? `${name}(error)` : `${name}(ok)`
            })
            .join(', ')
        : String(reply.chat_action ?? '-').trim() || '-'
      this.logger.warn(`[chatSiteAssitant] [3단계:Action수행] [reqId=${reqId}] ${summary}`)
    }

    const finalText = String(reply.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    this.logger.warn(`[chatSiteAssitant] [4단계:최종응답] [reqId=${reqId}] ${finalText || '-'}`)
  }

  private ensureReqId(body: any): string {
    const fromBody = String(body?.reqId ?? body?.requestId ?? '').trim()
    if (fromBody) {
      body.reqId = fromBody
      return fromBody
    }

    const now = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 8)
    const reqId = `req-${now}-${rand}`
    body.reqId = reqId
    return reqId
  }

  /**
   * 모든 채팅 입력은 어떤 경로를 타든 chat_log 에 남아야 한다.
   * 경로별 저장을 놓치거나 중간에 예외가 나도 여기서 마지막으로 한 번 저장한다.
   */
  async handleChat(body: any): Promise<ChatReply> {
    const reqId = this.ensureReqId(body)
    resetFlowTrace(reqId, {
      route: [this.normalize(body?.currentApp), this.normalize(body?.currentPath)].filter(Boolean).join('/'),
      message: this.normalize(body?.message),
    })

    let reply: ChatReply | undefined
    try {
      reply = await this.runChatFlow(body, reqId)
      return reply
    } catch (e: any) {
      this.stageLog('9단계:예외', 'fail', `채팅 처리 중 예외: ${e?.message ?? String(e)}`, reqId)
      throw e
    } finally {
      if (body?.__chatLogSaved !== true) {
        this.stageLog('9단계:응답저장_보정', 'fallback', '경로별 저장이 없어 마지막 단계에서 chat_log 저장', reqId)
        await this.saveLog(
          body,
          reply ?? { chat_action: this.normalize(body?.currentPath) || 'default', text: '' },
          undefined,
          this.buildChatLogDebugMeta(
            { body, reqId } as ChatContext,
            reply ?? { chat_action: 'default', text: '' },
            undefined,
            'orchestrator',
          ),
        )
      }
    }
  }

  private async runChatFlow(body: any, reqId: string): Promise<ChatReply> {
    this.stageLog('1단계:요청수신', 'received', '채팅 요청 수신 및 파이프라인 시작', reqId)

    const runtime = await this.resolveRuntime()
    this.stageLog('1-1단계:런타임확보', 'ready', 'LLM/오케스트레이터 런타임 확보 완료', reqId)
    // this.logger.log(`[handleChat] runtime ${JSON.stringify(runtime)}`)
    // validation check
    runtime.llm.assertConfig()
    this.stageLog('1-2단계:런타임검증', 'validated', 'LLM 설정 유효성 검증 완료', reqId)

    const ctx = await this.buildChatContext(body, runtime)
    this.stageLog('2단계:컨텍스트구성', 'built', `routeKey=${ctx.key} 기준 대화 컨텍스트 구성 완료`, reqId)
    // this.logger.log(`[handleChat] ctx ${JSON.stringify(ctx)}`)

    const frontRuleReply = await this.tryFrontRuleEngine(ctx)
    if (frontRuleReply) {
      this.stageLog('3단계:룰우선처리', 'served', '화면별 front-rule 처리로 응답 완료', reqId)
      return ensureUserFacingReply(this.withSuggestedActions(
        this.withTaskflowExplanationImages(
          this.attachPipelineTrace(
            frontRuleReply,
            'rule(front-rule)=>direct(info|action)=>응답조립',
          ),
          ctx,
        ),
        ctx,
      ))
    }

    this.stageLog('4단계:화면파이프라인', 'running', '등록 화면 파이프라인 처리 시작', reqId)
    const pipelineReply = await this.handleScreenPipeline(ctx)
    if (pipelineReply) {
      const fallbackReply = await this.tryComposeTaskflowFallback(ctx, pipelineReply)
      if (fallbackReply) {
        this.stageLog('4-1단계:화면파이프라인', 'completed', '화면 파이프라인 후 태스크플로우 draft 폴백 반영 완료', reqId)
        return ensureUserFacingReply(this.withSuggestedActions(
          this.withTaskflowExplanationImages(
            this.attachPipelineTrace(
              fallbackReply,
              'llm(공통 프롬프트+앱별 프롬프트)=>분기(action)=>tool(compose_linear_taskflow)=>응답조립',
            ),
            ctx,
          ),
          ctx,
        ))
      }
      this.stageLog('4-1단계:화면파이프라인', 'completed', '화면 파이프라인에서 응답 생성 완료', reqId)
      return ensureUserFacingReply(this.withSuggestedActions(
        this.withTaskflowExplanationImages(
          this.attachPipelineTrace(
            pipelineReply,
            'llm(공통 프롬프트+앱별 프롬프트)=>분기(action|info)=>응답조립',
          ),
          ctx,
        ),
        ctx,
      ))
    }

    // 미등록 화면 또는 pipeline 실패 시 기존 guidance 경로
    this.stageLog('5단계:가이던스폴백', 'fallback', '등록 화면 처리 불가로 기본 안내 경로 진입', reqId)
    const guidanceReply = await this.handleGuidance(ctx)
    this.stageLog('5-1단계:가이던스폴백', 'completed', '기본 안내 응답 생성 완료', reqId)
    return ensureUserFacingReply(this.withSuggestedActions(
      this.withTaskflowExplanationImages(
        this.attachPipelineTrace(
          guidanceReply,
          'llm(공통 프롬프트+앱별 프롬프트)=>guidance-llm=>응답조립',
        ),
        ctx,
      ),
      ctx,
    ))
  }

  private attachPipelineTrace(reply: ChatReply, fallbackTrace: string): ChatReply {
    const existingConfidence = Number((reply as Record<string, unknown>)?.pipelineConfidence)
    const confidence = Number.isFinite(existingConfidence) ? existingConfidence : undefined
    const existingTrace = String((reply as Record<string, unknown>)?.pipelineTrace ?? '').trim()
    if (existingTrace) {
      return {
        ...reply,
        pipelineTrace: existingTrace,
        ...(confidence !== undefined ? { pipelineConfidence: confidence } : {}),
      }
    }

    const trace = String(fallbackTrace ?? '').trim()
    if (!trace) return reply

    return {
      ...reply,
      pipelineTrace: trace,
      ...(confidence !== undefined ? { pipelineConfidence: confidence } : {}),
    }
  }

  private formatPipelineConfidence(value: unknown): string {
    const n = Number(value)
    if (!Number.isFinite(n)) return '-'
    return n.toFixed(2)
  }

  private extractPipelineConfidence(meta: unknown): number | undefined {
    if (!meta || typeof meta !== 'object') return undefined
    const row = meta as Record<string, unknown>
    const result = row.pipelineIntentResult
    if (!result || typeof result !== 'object') return undefined
    const confidence = Number((result as Record<string, unknown>).confidence)
    return Number.isFinite(confidence) ? confidence : undefined
  }

  private buildOrchestratorPipelineTrace(meta: unknown): string {
    if (!meta || typeof meta !== 'object') {
      return 'rule(미매칭)=>llm(공통 프롬프트+앱별 프롬프트)=>분기(action|info)=>응답조립'
    }

    const row = meta as Record<string, unknown>
    const pipelineIntent = String(row.pipelineIntent ?? '').trim().toLowerCase()
    const confidence = this.formatPipelineConfidence(this.extractPipelineConfidence(meta))
    const ruleMatched = Boolean(row.ruleMatched)
    const ruleStep = `rule(${ruleMatched ? '매칭' : '미매칭'})`

    if (pipelineIntent === 'action') {
      return `${ruleStep}=>llm(공통 프롬프트+앱별 프롬프트)=>분기(action, 신뢰도 ${confidence})=>llm(액션 프롬프트)=>tool/응답조립`
    }

    if (pipelineIntent === 'info') {
      const usedCollection = String(row.usedCollection ?? '').trim()
      const defaultLlmFallback = Boolean(row.defaultLlmFallback)
      const ragCollections = Array.isArray(row.ragCollections)
        ? row.ragCollections.map((item) => String(item ?? '').trim()).filter(Boolean)
        : []
      const hasCommonCollection = ragCollections.includes('common')

      const llmStep = defaultLlmFallback ? '=>llm(정보 프롬프트)' : ''

      // 실제로 조회에 성공한 컬렉션 기준으로 파이프라인 트레이스를 표기한다.
      // ragCollections 에 common 이 포함되어도 usedCollection 이 화면 컬렉션이면 화면 RAG로 기록한다.
      if (usedCollection === 'common') {
        return `${ruleStep}=>rag(공통, 신뢰도 ${confidence})${llmStep}=>응답조립`
      }

      if (usedCollection) {
        const usedLabel = usedCollection === 'common' ? '공통' : '화면'
        return `${ruleStep}=>rag(${usedLabel}, 신뢰도 ${confidence})${llmStep}=>응답조립`
      }

      if (hasCommonCollection) {
        return `${ruleStep}=>rag(화면, 신뢰도 ${confidence})=>rag(공통)=>llm(정보 프롬프트)=>응답조립`
      }

      return `${ruleStep}=>rag(화면, 신뢰도 ${confidence})=>llm(정보 프롬프트)=>응답조립`
    }

    return `${ruleStep}=>llm(공통 프롬프트+앱별 프롬프트)=>분기(action|info, 신뢰도 ${confidence})=>응답조립`
  }

  private normalizeRouteLike(value: string): string {
    return String(value ?? '').trim().replace(/^\/+/, '')
  }

  private inferAppKeyFromRoute(routeKey: string): string {
    const normalized = this.normalizeRouteLike(routeKey)
    return normalized.split('/').filter(Boolean)[0] || ''
  }

  private buildNavigationSuggestions(ctx: ChatContext): SuggestedAction[] {
    const store = getPromptStore()
    const screensRaw = store?.getEnabledScreens() ?? []

    const allScreens: ScreenSummary[] = screensRaw.map((row) => ({
      appKey: String(row.appKey ?? '').trim(),
      key: this.normalizeRouteLike(String(row.screenKey ?? '')),
      screenName: String(row.screenName ?? '').trim(),
    })).filter((row) => row.appKey && row.key && row.screenName)

    if (allScreens.length === 0) {
      return []
    }

    const currentRoute = this.normalizeRouteLike(ctx.key)
    const currentApp = this.normalize(ctx.currentApp) || this.inferAppKeyFromRoute(currentRoute)

    const sameApp = allScreens
      .filter((row) => row.appKey === currentApp && row.key !== currentRoute)
      .sort((a, b) => a.key.localeCompare(b.key))

    const crossAppPriorityKeys = ['robot/dashboard', 'ota/campaign', 'cms/content', 'tms']
    const crossApp: ScreenSummary[] = []
    for (const key of crossAppPriorityKeys) {
      const hit = allScreens.find((row) => row.key === key && row.key !== currentRoute)
      if (hit) crossApp.push(hit)
    }

    const merged = [...sameApp, ...crossApp]
    const deduped: ScreenSummary[] = []
    const seen = new Set<string>()
    for (const row of merged) {
      if (seen.has(row.key)) continue
      seen.add(row.key)
      deduped.push(row)
      if (deduped.length >= 6) break
    }

    return deduped.map((screen) => ({
      id: `nav-${screen.key}`,
      type: 'navigation',
      label: screen.screenName,
      keyword: `${screen.screenName} 화면으로 이동해줘`,
      chat_action: 'navigation',
      chat_action_param: {
        path: screen.key,
        app: screen.appKey,
      },
    }))
  }

  private withSuggestedActions(reply: ChatReply, ctx: ChatContext): ChatReply {
    if (
      this.isTmsCanvasRoute(ctx.key) &&
      this.looksLikeTaskflowComposeMessage(ctx.message, ctx.taskflowClassifierRules) &&
      !this.hasCanvasDraftParam(reply)
    ) {
      // 구성 요청인데 draft 없는 응답을 suggested_actions로 덮어 실패를 감추지 않도록 한다.
      return reply
    }

    if (isInfoPipelineReply(reply) && !String(reply?.text ?? '').trim()) {
      return reply
    }

    const suggestions = this.buildNavigationSuggestions(ctx)
    if (suggestions.length === 0) return reply

    const nextParam = { ...(reply.chat_action_param ?? {}), suggested_actions: suggestions }
    return {
      ...reply,
      chat_action_param: nextParam,
    }
  }

  private isTmsCanvasRoute(routeKey: string): boolean {
    const normalized = this.normalizeRouteLike(routeKey)
    return /^(?:tms\/)?taskflows\/(?:[^/]+|:taskFlowId|:id)\/canvas(?:\/|$)/.test(normalized)
  }

  private hasClassifierPhrase(text: string, phrases: string[]): boolean {
    return includesConfiguredPhrase(text, Array.isArray(phrases) ? phrases : [])
  }

  private looksLikeTaskflowComposeMessage(message: string, rules: TaskflowClassifierRules): boolean {
    const text = this.normalize(message)
    if (!text) return false

    const hasArrowSequenceByRule =
      Boolean(rules.arrowSequenceEnabled)
      && this.hasClassifierPhrase(text, rules.composeMoveHintKeywords)
    if (hasArrowSequenceByRule) return true

    const asksCompose = this.hasClassifierPhrase(text, rules.composeRequestKeywords)
    if (!asksCompose) return false

    return this.hasClassifierPhrase(text, rules.composeMoveHintKeywords)
  }

  /** 캔버스/노드 편집을 요청하는 문장인지. 판단 문구는 전부 rule 테이블에서 온다. */
  private looksLikeScreenEditRequest(message: string, ctx: ChatContext): boolean {
    const text = this.normalize(message)
    if (!text) return false

    const rules = ctx.taskflowClassifierRules
    if (!rules) return false

    if (this.looksLikeTaskflowComposeMessage(text, rules)) return true
    if (this.hasClassifierPhrase(text, rules.editVerbKeywords)) return true

    return this.hasClassifierPhrase(text, rules.actionRequestKeywords)
      && (
        this.hasClassifierPhrase(text, rules.editSubjectKeywords)
        || this.hasClassifierPhrase(text, rules.clauseSeparatorPhrases)
      )
  }

  private hasCanvasDraftParam(reply: ChatReply | null | undefined): boolean {
    if (!reply?.chat_action_param || typeof reply.chat_action_param !== 'object') return false

    const param = reply.chat_action_param as Record<string, unknown>
    if (param.canvasDraft && typeof param.canvasDraft === 'object') return true

    const toolResult =
      param.toolResult && typeof param.toolResult === 'object'
        ? (param.toolResult as Record<string, unknown>)
        : undefined

    return Boolean(toolResult?.canvasDraft && typeof toolResult.canvasDraft === 'object')
  }

  private looksLikeTaskflowExplanationMessage(
    message: string,
    reply: ChatReply,
    rules: TaskflowClassifierRules,
  ): boolean {
    const sourceText = `${this.normalize(message)} ${this.normalize(reply?.text)}`
    if (!sourceText) return false

    const hasExplanationKeyword = this.hasClassifierPhrase(sourceText, rules.explanationKeywords)
    if (!hasExplanationKeyword) return false

    const looksLikeComposeRequest = this.hasClassifierPhrase(this.normalize(message), rules.composeRequestKeywords)
    return !looksLikeComposeRequest
  }

  private scoreTaskflowExplanationChunk(query: string, chunk: RagChunkData): number {
    const normalizedQuery = this.normalize(query).toLowerCase()
    if (!normalizedQuery) return 0

    let score = 0

    for (const keyword of Array.isArray(chunk.keywords) ? chunk.keywords : []) {
      const normalizedKeyword = String(keyword ?? '').trim().toLowerCase()
      if (!normalizedKeyword) continue
      if (normalizedQuery.includes(normalizedKeyword)) {
        score += normalizedKeyword.length >= 4 ? 5 : 3
      }
    }

    const title = String(chunk.title ?? '').trim().toLowerCase()
    if (title && normalizedQuery.includes(title)) score += 4

    const body = String(chunk.body ?? '').trim().toLowerCase()
    if (body) {
      const bodyTerms = body.split(/[^\p{L}\p{N}_]+/u).filter((term) => term.length >= 2)
      for (const term of bodyTerms.slice(0, 32)) {
        if (normalizedQuery.includes(term.toLowerCase())) score += 1
      }
    }

    return score
  }

  private resolveTaskflowExplanationChunk(
    routeKey: string,
    message: string,
    reply: ChatReply,
    rules: TaskflowClassifierRules,
  ): RagChunkData | null {
    const store = getPromptStore()
    const normalizedRouteKey = findNearestRegisteredRouteKey(routeKey, undefined, this.logger) ?? this.normalizeRouteLike(routeKey)
    const collection = store?.getCollection(normalizedRouteKey)
    if (!collection) return null

    const query = `${this.normalize(message)} ${this.normalize(reply?.text)}`.trim()
    if (!query) return null

    const candidates = collection.chunks.filter((chunk) => Boolean(String(chunk?.imageUrl ?? '').trim()))
    if (candidates.length === 0) return null

    const scored = candidates
      .map((chunk) => ({ chunk, score: this.scoreTaskflowExplanationChunk(query, chunk) }))
      .filter((item) => item.score >= Number(rules.explanationImageMinScore ?? 5))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return String(left.chunk.id ?? '').localeCompare(String(right.chunk.id ?? ''))
      })

    return scored[0]?.chunk ?? null
  }

  private resolveTaskflowExplanationImages(
    routeKey: string,
    message: string,
    reply: ChatReply,
    rules: TaskflowClassifierRules,
  ): ChatReplyImage[] {
    const matched = this.resolveTaskflowExplanationChunk(routeKey, message, reply, rules)
    if (!matched) return []

    const src = String(matched.imageUrl ?? '').trim()
    if (!src) return []

    return [{
      id: `taskflow-node-${matched.id}`,
      src,
      alt: String(matched.title ?? '').trim() || 'taskflow explanation image',
      title: String(matched.title ?? '').trim(),
      caption: String(matched.body ?? '').trim(),
    }]
  }

  private withTaskflowExplanationImages(reply: ChatReply, ctx: ChatContext): ChatReply {
    if (!this.isTmsCanvasRoute(ctx.key)) return reply
    if (this.hasCanvasDraftParam(reply)) return reply
    if (!this.looksLikeTaskflowExplanationMessage(ctx.message, reply, ctx.taskflowClassifierRules)) return reply

    const images = this.resolveTaskflowExplanationImages(
      ctx.key,
      ctx.message,
      reply,
      ctx.taskflowClassifierRules,
    )
    if (images.length === 0) return reply

    return {
      ...reply,
      images,
    }
  }

  private async tryComposeTaskflowFallback(
    ctx: ChatContext,
    reply: ChatReply,
  ): Promise<ChatReply | null> {
    const matchedRouteKey = findNearestRegisteredRouteKey(ctx.key, ctx.reqId, this.logger) ?? ctx.key
    if (!this.isTmsCanvasRoute(matchedRouteKey)) return null
    if (!this.looksLikeTaskflowComposeMessage(ctx.message, ctx.taskflowClassifierRules)) return null
    if (this.hasCanvasDraftParam(reply)) return null

    const actionParam = reply?.chat_action_param && typeof reply.chat_action_param === 'object'
      ? (reply.chat_action_param as Record<string, unknown>)
      : undefined
    const directClarification = String(actionParam?.clarification ?? '').trim()
    const nestedClarification =
      actionParam?.toolResult && typeof actionParam.toolResult === 'object'
        ? String((actionParam.toolResult as Record<string, unknown>).clarification ?? '').trim()
        : ''
    if (directClarification || nestedClarification) return null

    const screen = getScreenConfig(matchedRouteKey, ctx.reqId)
    const composeTool = screen?.actionTools?.find(
      (tool) => tool?.declaration?.name === 'compose_linear_taskflow',
    )
    if (!composeTool) {
      this.stageLog('4-7단계:태스크플로우폴백', 'skipped', 'compose_linear_taskflow 도구를 찾지 못해 폴백 불가', ctx.reqId)
      return null
    }

    const toolCtx = buildToolContextFromBody({
      body: ctx.body,
      message: ctx.message,
      actionRunnerUrl: this.pipelineCfg.actionRunnerUrl,
      log: {
        log: (m) => this.logger.log(m),
        error: (m) => this.logger.error(m),
      },
    })

    try {
      const result = await composeTool.execute({}, toolCtx)
      if (!result || typeof result !== 'object') {
        this.stageLog('4-7단계:태스크플로우폴백', 'miss', 'compose 도구 응답이 객체 형식이 아님', ctx.reqId)
        return null
      }

      const objectResult = result as Record<string, unknown>
      const canvasDraft = objectResult.canvasDraft
      if (!canvasDraft || typeof canvasDraft !== 'object') {
        this.stageLog('4-7단계:태스크플로우폴백', 'miss', 'compose 도구 응답에 canvasDraft 없음', ctx.reqId)
        return null
      }

      this.stageLog('4-7단계:태스크플로우폴백', 'applied', 'pipeline 응답에 draft가 없어 compose 도구 결과를 강제 반영', ctx.reqId)
      return {
        ...reply,
        chat_action_param: {
          toolName: 'compose_linear_taskflow',
          toolResult: objectResult,
        },
        text: String(objectResult.assistantText ?? '').trim() || '요청을 캔버스에 반영했습니다.',
      }
    } catch (e: any) {
      this.stageLog('4-7단계:태스크플로우폴백', 'error', `compose 도구 실행 실패(${e?.message ?? String(e)})`, ctx.reqId)
      return null
    }
  }

  private async resolveRuntime(): Promise<RuntimeEntry> {
    const provider = (await this.chatSetting.getLlmProvider()) as LlmProvider
    const cached = this.runtimeCache.get(provider)

    if (cached) {
      return cached
    }

    const llm = getDefaultLlmProvider(provider)

    const orchestrator = new ChatOrchestrator(
      llm.client,
      llm.maxOutputTokens,
      this.pipelineCfg,
    )

    const entry = { llm, orchestrator }

    this.runtimeCache.set(provider, entry)

    return entry
  }

  private async buildChatContext(body: any, runtime: RuntimeEntry): Promise<ChatContext> {
    const reqId = this.ensureReqId(body)
    const currentApp = this.normalize(body.currentApp)
    const currentPath = this.normalize(body.currentPath)
    const message = this.normalize(body.message)
    const key = this.resolveRouteKey(body, currentApp, currentPath, reqId)
    const taskflowClassifierRules = await loadTaskflowClassifierRules(key)
    const author = this.resolveAuthor(body)
    const conversationId = this.resolveConversationId(body)

    if (!body?.conversationId && conversationId) {
      body.conversationId = conversationId
    }

    if (!body?.key && key) {
      body.key = key
    }

    const history = await this.chatLog.buildHistoryContext({
      author: author || undefined,
      conversationId: conversationId || undefined,
      currentApp,
      hoursBack: 24,
      maxTurns: 200,
    })

    this.logger.log(
      `[chat] [reqId=${reqId}] status=loaded reason=대화 히스토리 컨텍스트 조회 완료`,
    )
    this.logger.log(
      `[chat] [trace][reqId=${reqId}] author=${author || '-'} conversationId=${conversationId || '-'} currentApp=${currentApp || '-'} turns=${history.length}`,
    )

    return {
      body,
      reqId,
      llm: runtime.llm,
      orchestrator: runtime.orchestrator,
      startedAt: Date.now(),
      author,
      conversationId,
      message,
      currentApp,
      currentPath,
      key,
      history,
      taskflowClassifierRules,
    }
  }

  private normalize(value?: string) {
    return String(value ?? '').trim()
  }

  private resolveRouteKey(body: any, currentApp: string, currentPath: string, reqId?: string): string {
    const explicitCandidates = [
      { source: 'key', value: this.normalize(body?.key) },
      { source: 'routeKey', value: this.normalize(body?.routeKey) },
      { source: 'screenRouteKey', value: this.normalize(body?.screenRouteKey) },
    ]

    const explicit = explicitCandidates.find((candidate) => candidate.value)
    if (explicit?.value) {
      this.logger.log(
        `[route-key] [reqId=${String(reqId ?? '-').trim() || '-'}] status=resolved reason=명시적 route 입력값(${explicit.source}) 사용`,
      )
      this.logger.log(
        `[route-key] [trace][reqId=${String(reqId ?? '-').trim() || '-'}] source=${explicit.source} key=${explicit.value} currentApp=${currentApp || '-'} currentPath=${currentPath || '-'}`,
      )
      return explicit.value
    }

    const app = this.normalize(currentApp)
    const path = this.normalize(currentPath).replace(/^\/+/, '')

    if (app && path) {
      if (path === app || path.startsWith(`${app}/`)) {
        this.logger.log(
          `[route-key] [reqId=${String(reqId ?? '-').trim() || '-'}] status=resolved reason=currentPath가 app prefix 규칙을 만족`,
        )
        this.logger.log(`[route-key] [trace][reqId=${String(reqId ?? '-').trim() || '-'}] source=currentPath key=${path}`)
        return path
      }
      const normalized = `${app}/${path}`.replace(/\/+/g, '/')
      this.logger.log(
        `[route-key] [reqId=${String(reqId ?? '-').trim() || '-'}] status=resolved reason=currentApp/currentPath 결합 규칙으로 route 생성`,
      )
      this.logger.log(`[route-key] [trace][reqId=${String(reqId ?? '-').trim() || '-'}] source=currentApp+currentPath key=${normalized}`)
      return normalized
    }

    const fallback = path || app
    this.logger.log(
      `[route-key] [reqId=${String(reqId ?? '-').trim() || '-'}] status=fallback reason=명시적 route 정보가 없어 fallback 규칙 적용`,
    )
    this.logger.log(`[route-key] [trace][reqId=${String(reqId ?? '-').trim() || '-'}] source=fallback key=${fallback || '-'}`)
    return fallback
  }

  private resolveAuthor(body: any): string {
    return (
      this.normalize(body?.author) ||
      this.normalize(body?.user?.id) ||
      this.normalize(body?.user?.userId) ||
      this.normalize(body?.context?.user?.id) ||
      this.normalize(body?.context?.user?.userId) ||
      this.normalize(body?.context?.userId) ||
      this.normalize(body?.context?.accountId) ||
      ''
    )
  }

  private resolveLoginUser(body: any): {
    userId?: string
    userName?: string
    userEmail?: string
    accountId?: string
  } | undefined {
    const userId =
      this.normalize(body?.user?.id) ||
      this.normalize(body?.user?.userId) ||
      this.normalize(body?.context?.user?.id) ||
      this.normalize(body?.context?.user?.userId) ||
      this.normalize(body?.context?.userId) ||
      this.normalize(body?.author)

    const userName =
      this.normalize(body?.user?.name) ||
      this.normalize(body?.user?.userName) ||
      this.normalize(body?.context?.user?.name) ||
      this.normalize(body?.context?.user?.userName)

    const userEmail =
      this.normalize(body?.user?.email) ||
      this.normalize(body?.context?.user?.email)

    const accountId =
      this.normalize(body?.user?.accountId) ||
      this.normalize(body?.context?.user?.accountId) ||
      this.normalize(body?.context?.accountId)

    if (!userId && !userName && !userEmail && !accountId) {
      return undefined
    }

    return {
      userId: userId || undefined,
      userName: userName || undefined,
      userEmail: userEmail || undefined,
      accountId: accountId || undefined,
    }
  }

  private resolveConversationId(body: any): string {
    const incoming = this.normalize(body?.conversationId)
    if (incoming) return incoming
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  /**
   * 화면 우선 pipeline 처리.
   *
   * 순서:
   * 1. 등록된 화면인지 확인
   * 2. 화면별 handler 선택
   * 3. 화면 안에서 intent 분류
   * 4. intent별 처리
   */
  private async handleScreenPipeline(ctx: ChatContext): Promise<ChatReply | null> {
    this.stageLog('4-1단계:화면매칭', 'running', `requestedRoute=${ctx.key} 화면 매칭 시작`, ctx.reqId)
    const matchedRouteKey = findNearestRegisteredRouteKey(ctx.key, ctx.reqId, this.logger)

    if (!matchedRouteKey) {
      this.stageLog('4-1단계:화면매칭', 'not-found', '등록된 화면을 찾지 못해 guidance 폴백 예정', ctx.reqId)
      return null
    }

    const routeCtx =
      matchedRouteKey === ctx.key
        ? ctx
        : {
            ...ctx,
            key: matchedRouteKey,
            body: {
              ...ctx.body,
              originalRouteKey: ctx.key,
              routeKey: matchedRouteKey,
              screenRouteKey: matchedRouteKey,
            },
          }

    if (matchedRouteKey !== ctx.key) {
      this.stageLog('4-2단계:라우트보정', 'adjusted', '요청 route가 미등록이라 근접 등록 route로 보정', ctx.reqId)
      this.logger.log(`[handleScreenPipeline] [trace] original=${ctx.key} matched=${matchedRouteKey}`)
    }

    this.stageLog('4-3단계:화면디스패치', 'dispatched', `route=${routeCtx.key} 화면 핸들러로 분기`, ctx.reqId)
    try {
      if (routeCtx.key === 'robot/ailog/event') {
        return this.handleRobotAilogEventScreen(routeCtx)
      }

      if (routeCtx.key.startsWith('robot/ailog/')) {
        return this.handleRobotAilogChildScreen(routeCtx)
      }

      if (routeCtx.key.startsWith('robot/')) {
        return this.handleRobotGenericScreen(routeCtx)
      }

      return this.handleGenericRegisteredScreen(routeCtx)
    } catch (e: any) {
      this.logger.error(
        `[chat] screen pipeline error route=${routeCtx.key} err=${e?.message ?? String(e)}`,
      )
      this.stageLog('4-3단계:화면디스패치', 'error', '화면 핸들러 처리 중 예외 발생', ctx.reqId)
      return null
    }
  }

  /**
   * robot/ailog/event 전용 처리.
   *
   * 여기서는 화면이 먼저 확정된 상태에서 message intent를 분류한다.
   */
  private async handleRobotAilogEventScreen(ctx: ChatContext): Promise<ChatReply | null> {
    const task = this.classifyRobotAilogEventTask(ctx.message)

    this.logger.log(
      `[handleRobotAilogEventScreen] [reqId=${ctx.reqId}] status=classified reason=robot/ailog/event 전용 task 분류 완료`,
    )
    return this.runOrchestrator(ctx, task)
  }

  private classifyRobotAilogEventTask(message: string): ScreenTask {
    const text = message.toLowerCase()

    if (this.includesAny(text, ['실행', '수행', 'run', '조치해', '처리해'])) {
      return 'run_action'
    }

    if (this.includesAny(text, ['추천', '조치', '액션', 'action', '대응'])) {
      return 'recommend_action'
    }

    // "분석 방법", "가이드" 같은 문장은 실행이 아니라 info RAG 안내로 본다.
    if (this.includesAny(text, ['설명', '도움말', '가이드', '방법', 'guide'])) {
      return 'guide'
    }

    if (this.includesAny(text, ['분석', '원인', '왜', '이유', 'analyze'])) {
      return 'analyze'
    }

    if (this.includesAny(text, ['요약', 'summary', '정리'])) {
      return 'summary'
    }

    if (this.includesAny(text, ['조회', '검색', '찾아', '보여', 'list', 'search', '이벤트'])) {
      return 'list'
    }

    return 'unknown'
  }
  private async handleRobotAilogChildScreen(ctx: ChatContext): Promise<ChatReply | null> {
    const intent = this.classifyGenericScreenTask(ctx.message, ctx)

    this.logger.log(
      `[chat] [reqId=${ctx.reqId}] status=classified reason=자식 화면의 generic task 분류 완료`,
    )

    return this.runOrchestrator(ctx, intent)
  }

  /**
   * robot 일반 화면 처리.
   *
   * 예:
   * - robot/dashboard
   * - robot/management
   * - robot/groups
   * - robot/users
   */
  private async handleRobotGenericScreen(ctx: ChatContext): Promise<ChatReply | null> {
    const intent = this.classifyGenericScreenTask(ctx.message, ctx)

    this.logger.log(
      `[chat] [reqId=${ctx.reqId}] status=classified reason=robot 일반 화면의 generic task 분류 완료`,
    )

    return this.runOrchestrator(ctx, intent)
  }

  /**
   * robot 외 등록 화면 처리.
   * 현재는 ota/cms/tms 세부 화면이 아직 없으므로 generic 처리만 둔다.
   */
  private async handleGenericRegisteredScreen(ctx: ChatContext): Promise<ChatReply | null> {
    const intent = this.classifyGenericScreenTask(ctx.message, ctx)

    this.logger.log(
      `[chat] [reqId=${ctx.reqId}] status=classified reason=등록 화면의 generic task 분류 완료`,
    )

    return this.runOrchestrator(ctx, intent)
  }

  private classifyGenericScreenTask(message: string, ctx?: ChatContext): ScreenTask {
    const text = message.toLowerCase()

    // 콘텐츠 이름에 '설명' 같은 말이 들어가는 경우가 있어, 키워드로 guide 를 붙이기 전에
    // 룰이 편집/구성 요청으로 보는 문장인지 먼저 확인한다. guide 로 붙으면 orchestrator 가 info 로 강제한다.
    if (ctx && this.looksLikeScreenEditRequest(message, ctx)) {
      return 'unknown'
    }

    if (this.includesAny(text, ['생성', '추가', '등록', 'create', 'add'])) {
      return 'create'
    }

    if (this.includesAny(text, ['수정', '변경', '업데이트', 'update', 'edit'])) {
      return 'update'
    }

    if (this.includesAny(text, ['삭제', '제거', 'delete', 'remove'])) {
      return 'delete'
    }

    if (this.includesAny(text, ['조회', '검색', '찾아', '보여', 'list', 'search'])) {
      return 'list'
    }

    if (this.includesAny(text, ['분석', '원인', '왜', '이유', 'analyze'])) {
      return 'analyze'
    }

    if (this.includesAny(text, ['요약', 'summary', '정리'])) {
      return 'summary'
    }

    if (this.includesAny(text, ['설정', 'setting', 'config'])) {
      return 'settings'
    }

    if (this.includesAny(text, ['설명', '도움말', '가이드', '방법', 'guide'])) {
      return 'guide'
    }

    return 'unknown'
  }

  private includesAny(text: string, keywords: string[]) {
    return keywords.some((keyword) => text.includes(keyword))
  }

  /**
   * 실제 pipeline/orchestrator 실행.
   *
   * 화면과 intent를 먼저 확정한 다음 orchestrator에 넘긴다.
   * orchestrator 내부에서는 이 screenTask를 기준으로 RAG/action 분기하면 된다.
   */
  private async runOrchestrator(
    ctx: ChatContext,
    intent: ScreenTask,
  ): Promise<ChatReply | null> {
    this.stageLog('4-4단계:오케스트레이터실행', 'running', `route=${ctx.key} screenTask=${intent} 실행 시작`, ctx.reqId)
    const promptStore = getPromptStore()
    const instructionMeta = promptStore?.getPromptMeta('common', CHAT_PROMPT_TYPE.instruction)
    const ragInfoMeta = promptStore?.getPromptMeta('common', CHAT_PROMPT_TYPE.ragInfo)
    const ragActionMeta = promptStore?.getPromptMeta('common', CHAT_PROMPT_TYPE.ragAction)
    this.logger.log(
      `######## 오케스트레이터 적용 프롬프트 아이디 ########\n[reqId=${ctx.reqId}] [route=${ctx.key}] [screenTask=${intent}]\n- common/instruction: ${instructionMeta?.id ?? '-'} enabled=${instructionMeta?.enabled ?? false}\n- common/rag-info: ${ragInfoMeta?.id ?? '-'} enabled=${ragInfoMeta?.enabled ?? false}\n- common/rag-action: ${ragActionMeta?.id ?? '-'} enabled=${ragActionMeta?.enabled ?? false}\n######################################`,
    )
    const pipelineBody = {
      ...ctx.body,
      reqId: ctx.reqId,
      routeKey: ctx.key,
      screenRouteKey: ctx.key,
      screenTask: intent,
      history: ctx.history,
    }
    const out = await ctx.orchestrator.handle(
      ctx.key,
      ctx.message,
      pipelineBody,
    )
    this.logger.log(
      `######## 오케스트레이터 실행 결과 ########\n[reqId=${ctx.reqId}]\n- handled: ${out.handled}\n- replyText: ${JSON.stringify(out.reply?.text ?? '')}\n- pipelineIntent: ${String((out.meta as Record<string, unknown> | undefined)?.pipelineIntent ?? '-')}\n- usedCollection: ${String((out.meta as Record<string, unknown> | undefined)?.usedCollection ?? '-')}\n- usedChunks: ${JSON.stringify((out.meta as Record<string, unknown> | undefined)?.usedChunks ?? [])}\n######################################`,
    )
    this.stageLog('4-5단계:오케스트레이터결과', 'completed', `handled=${String(out.handled)} hasReply=${String(Boolean(out.reply))}`, ctx.reqId)
    if (out.handled && out.reply) {
      const pipelineTrace = this.buildOrchestratorPipelineTrace(out.meta)
      const pipelineConfidence = this.extractPipelineConfidence(out.meta)
      const meta = out.meta && typeof out.meta === 'object' ? (out.meta as Record<string, unknown>) : undefined
      const usedCollection = String(meta?.['usedCollection'] ?? '').trim()
      const actionRagCollection = String(meta?.['actionRagCollection'] ?? '').trim()
      const primaryChunkKey = String(meta?.['primaryChunkKey'] ?? '').trim()
      const usedChunksRaw = meta?.['usedChunks']
      const actionRagChunksRaw = meta?.['actionRagChunks']
      const usedChunks = Array.isArray(usedChunksRaw)
        ? usedChunksRaw
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
        : Array.isArray(actionRagChunksRaw)
          ? actionRagChunksRaw
              .map((item) => String(item ?? '').trim())
              .filter(Boolean)
          : []
      const ragScoresRaw = meta?.['ragScores']
      const ragScores = Array.isArray(ragScoresRaw) ? ragScoresRaw : []
      const tracedReply = this.attachPipelineTrace(
        out.reply,
        pipelineTrace,
      )
      const normalizedReply = ensurePeriodInEventReply(tracedReply)
      if (pipelineConfidence !== undefined) {
        normalizedReply.pipelineConfidence = pipelineConfidence
      }
      if (usedCollection || actionRagCollection) {
        normalizedReply.usedCollection = usedCollection || actionRagCollection
      }
      if (primaryChunkKey) {
        normalizedReply.primaryChunkKey = primaryChunkKey
      }
      if (usedChunks.length > 0) {
        normalizedReply.usedChunks = usedChunks
      }
      if (ragScores.length > 0) {
        normalizedReply.ragScores = ragScores.map((item) => ({
          collection: String((item as Record<string, unknown>)?.collection ?? '').trim(),
          topScore: Number((item as Record<string, unknown>)?.topScore ?? 0),
          adjustedScore: Number((item as Record<string, unknown>)?.adjustedScore ?? 0),
          hitCount: Number((item as Record<string, unknown>)?.hitCount ?? 0),
          topChunks: Array.isArray((item as Record<string, unknown>)?.topChunks)
            ? ((item as Record<string, unknown>)?.topChunks as unknown[])
              .map((row) => ({
                chunkKey: String((row as Record<string, unknown>)?.chunkKey ?? '').trim(),
                title: String((row as Record<string, unknown>)?.title ?? '').trim() || undefined,
                finalScore: Number((row as Record<string, unknown>)?.finalScore ?? 0),
                rawScore: Number((row as Record<string, unknown>)?.rawScore ?? 0),
              }))
              .filter((row) => Boolean(row.chunkKey))
            : [],
          topChunkIds: Array.isArray((item as Record<string, unknown>)?.topChunkIds)
            ? ((item as Record<string, unknown>)?.topChunkIds as unknown[]).map((chunkId) => String(chunkId ?? '').trim()).filter(Boolean)
            : [],
          relaxed: Boolean((item as Record<string, unknown>)?.relaxed),
        }))
      }
      this.emitCompactPipelineWarnLogs(ctx, meta, normalizedReply)
      await this.saveLog(ctx.body, normalizedReply, ctx, this.buildChatLogDebugMeta(ctx, normalizedReply, meta, 'orchestrator'))
      this.stageLog('4-6단계:응답저장', 'saved', '오케스트레이터 응답을 chat_log에 저장 완료', ctx.reqId)
      return normalizedReply
    }

    this.stageLog('4-6단계:응답저장', 'skipped', '오케스트레이터에서 유효 응답이 없어 저장 생략', ctx.reqId)
    return null
  }

  private resolveFrontRuleCollections(routeKey: string): string[] {
    const screen = getScreenConfig(routeKey)
    if (!screen) return ['common']

    const values = [
      'common',
      String(screen.ragCollection ?? '').trim(),
      String(screen.appKey ?? '').trim(),
    ].filter(Boolean)

    return Array.from(new Set(values))
  }

  private resolveFrontRuleChunks(routeKey: string, chunkKeys: string[]): Array<{ key: string; title: string; body: string; collection: string }> {
    const keys = Array.from(new Set((Array.isArray(chunkKeys) ? chunkKeys : []).map((item) => String(item ?? '').trim()).filter(Boolean)))
    if (keys.length === 0) return []

    const store = getPromptStore()
    if (!store) return []

    const collections = this.resolveFrontRuleCollections(routeKey)
    const found: Array<{ key: string; title: string; body: string; collection: string }> = []
    const seen = new Set<string>()

    for (const chunkKey of keys) {
      if (seen.has(chunkKey)) continue

      for (const collectionName of collections) {
        const collection = store.getCollection(collectionName)
        if (!collection) continue

        const chunk = (Array.isArray(collection.chunks) ? collection.chunks : []).find((row) => String(row.id ?? '').trim() === chunkKey)
        if (!chunk) continue

        found.push({
          key: chunkKey,
          title: String(chunk.title ?? '').trim(),
          body: String(chunk.body ?? '').trim(),
          collection: collectionName,
        })
        seen.add(chunkKey)
        break
      }
    }

    return found
  }

  private renderFrontRuleTemplate(
    template: string | undefined,
    message: string,
    chunks: Array<{ key: string; title: string; body: string }>,
  ): string {
    const rawTemplate = String(template ?? '').trim()
    const chunkBodies = chunks.map((row) => row.body).filter(Boolean)
    const chunkTitles = chunks.map((row) => row.title).filter(Boolean)

    if (!rawTemplate) {
      if (chunkBodies.length > 0) return chunkBodies.join('\n\n')
      return ''
    }

    return rawTemplate
      .replace(/\$message/g, message)
      .replace(/\$chunks/g, chunkBodies.join('\n\n'))
      .replace(/\$chunkTitles/g, chunkTitles.join(', '))
  }

  private resolveRuleTool(routeKey: string, toolName: string): ToolDefinition | null {
    const name = String(toolName ?? '').trim()
    if (!name) return null

    if (name === 'query_events') return queryEvents

    const screen = getScreenConfig(routeKey)
    if (!screen) return null

    const allTools = [
      ...(Array.isArray(screen.dataTools) ? screen.dataTools : []),
      ...(Array.isArray(screen.actionTools) ? screen.actionTools : []),
      ...(Array.isArray(screen.commonActionTools) ? screen.commonActionTools : []),
    ]

    return allTools.find((tool) => String(tool?.declaration?.name ?? '').trim() === name) ?? null
  }

  private buildRuleFirstActionReply(
    routeKey: string,
    ruleMatch: FrontRuleMatch,
    toolName: string,
    toolResult: unknown,
  ): ChatReply {
    if (toolName === 'query_events') {
      const result = toolResult as any
      const filters = result?.resolvedFilters && typeof result.resolvedFilters === 'object'
        ? result.resolvedFilters
        : undefined
      const screen = getScreenConfig(routeKey)
      return {
        chat_action: ruleMatch.chatAction || screen?.chatActions.data || 'ailog/event/filter',
        chat_action_param: filters ? { filters } : undefined,
        text: toDisplayText(result?.summary)
          || String(ruleMatch.fallbackText ?? '').trim()
          || String(screen?.fallbackText ?? '').trim()
          || '조회 결과를 확인했습니다.',
      }
    }

    const resultRow = toolResult && typeof toolResult === 'object'
      ? (toolResult as Record<string, unknown>)
      : {}
    const text = toDisplayText(
      resultRow.text ?? resultRow.summary ?? resultRow.message ?? resultRow.assistantText ?? toolResult,
    )
    const screen = getScreenConfig(routeKey)
    const baseActionParam = ruleMatch.chatActionParam && typeof ruleMatch.chatActionParam === 'object'
      ? (ruleMatch.chatActionParam as Record<string, unknown>)
      : {}

    return {
      chat_action: ruleMatch.chatAction || screen?.chatActions.action || 'action',
      chat_action_param: {
        ...baseActionParam,
        toolName,
        toolResult: resultRow,
      },
      text: text
        || String(ruleMatch.fallbackText ?? '').trim()
        || String(screen?.fallbackText ?? '').trim()
        || '요청을 처리했습니다.',
    }
  }

  /** 룰이 캡처한 이름이 실제로 캔버스나 팔레트에 있는지 본다.
   * 룰 정규식은 문장 조각까지 삼킬 수 있어, 이름을 못 찾으면 룰 처리를 포기하고 LLM 경로로 넘긴다.
   */
  private canvasNameExists(ctx: ChatContext, name: string, kind: 'canvas' | 'palette'): boolean {
    const value = String(name ?? '').trim()
    if (!value) return false

    if (kind === 'canvas') {
      const graph = readCurrentGraphFromContext(ctx.body?.context)
      // 캔버스 정보를 못 받았으면 판단할 수 없다. 그때는 막지 않고 그대로 진행한다.
      if (graph.nodes.length === 0) return true
      return findGraphNodes(value, graph).length > 0
    }

    const contents = readTaskContentsFromContext(ctx.body?.context)
    const store = getPropertyTmsStore()
    if (Boolean(store?.get(resolveTaskAlias(value)))) return true
    if (contents.length === 0) return true
    return Boolean(findContentRef(value, '', contents))
  }

  /** 말로 센 순번을 프론트가 읽는 "이름 #N" 표기로 바꾼다. 표기 규칙은 rule 테이블에서 온다. */
  private async normalizeNodeTargetName(routeKey: string, value: string): Promise<string> {
    const raw = String(value ?? '').trim()
    if (!raw) return raw

    const rules = await loadTaskflowLanguageRules(routeKey)
    const parsed = parseNodeTarget(raw, {
      ordinalWords: rules.nodeTargetOrdinalWords,
      ordinalSuffixPhrases: rules.nodeTargetOrdinalSuffixPhrases,
      nounPhrases: rules.nodeTargetNounPhrases,
    })

    // "타임아웃" 처럼 사람이 부르는 이름은 Task 이름으로 바꿔야 프론트가 캔버스에서 찾는다.
    const name = resolveTaskAlias(parsed.name)
    return parsed.ordinal ? `${name} #${parsed.ordinal}` : name
  }

  /** taskflow-graph 룰(노드 연결/삭제)은 tool 없이 캔버스 draft를 바로 만들어 응답한다. */
  private async buildTaskflowGraphRuleReply(
    ctx: ChatContext,
    routeKey: string,
    ruleMatch: FrontRuleMatch,
  ): Promise<ChatReply | null> {
    if (ruleMatch.ruleType === 'taskflow-graph-guide') {
      const screen = getScreenConfig(routeKey)
      const guideText = String(ruleMatch.fallbackText ?? '').trim()
      const guidanceText = Array.isArray(screen?.guidanceExamples) && screen.guidanceExamples.length > 0
        ? `아래처럼 요청해보세요.\n${screen.guidanceExamples.join('\n')}`
        : ''

      const reply: ChatReply = {
        chat_action: ruleMatch.chatAction || screen?.chatActions.info || 'info',
        chat_action_param: {
          ...(ruleMatch.chatActionParam ?? {}),
          matchedRuleKey: ruleMatch.ruleKey,
        },
        text: guideText || guidanceText || '지원하는 요청 형식을 확인해 주세요.',
      }

      reply.pipelineConfidence = this.normalizeRuleConfidence(ruleMatch.confidence)
      reply.matchedRule = {
        source: 'front-rule',
        ruleKey: ruleMatch.ruleKey,
        ruleType: ruleMatch.ruleType,
        reason: ruleMatch.reason,
        confidence: this.normalizeRuleConfidence(ruleMatch.confidence),
      }

      await this.saveLog(ctx.body, reply, ctx, this.buildChatLogDebugMeta(ctx, reply, {
        pipelineIntent: 'info',
        pipelineConfidence: ruleMatch.confidence,
        pipelineTrace: `front-rule:${ruleMatch.ruleKey}`,
      }, 'front-rule'))

      return reply
    }

    if (ruleMatch.ruleType !== 'taskflow-graph') return null

    const ruleCaptures = this.getRuleCaptures(ruleMatch)
    const arrowLines = ruleMatch.graphOperation === 'separate-arrow-lines'
      ? String(ruleCaptures[0] ?? ctx.message)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .flatMap((line) => {
            const separators = Array.from(line.match(/->|=>|→|⇒/g) ?? [])
            const rawLabels = line.split(/->|=>|→|⇒/).map((item) => item.trim())
            const hasLeadingArrow = rawLabels[0] === ''
            const labels = hasLeadingArrow ? rawLabels.slice(1) : rawLabels
            const valid = labels.every(Boolean) && (hasLeadingArrow ? labels.length >= 1 : labels.length >= 2)
            return valid ? [{ labels, separators, hasLeadingArrow }] : []
          })
      : []

    const nodes = arrowLines.length > 0
      ? arrowLines.flatMap((line) => line.labels)
      : ruleMatch.graphOperation === 'append-leading'
      ? String(ruleCaptures[0] ?? '')
          .split(/->|=>|→|⇒/)
          .map((item) => item.trim())
          .filter(Boolean)
      : ruleCaptures
    this.logger.warn(
      `[front-rule][taskflow-graph] reqId=${ctx.reqId} ruleKey=${ruleMatch.ruleKey} nodes=${JSON.stringify(nodes)} direction=${ruleMatch.direction ?? '-'}`,
    )

    // append-tail 은 추가할 노드 이름 하나만 있으면 된다. 기준은 프론트가 흐름의 꼬리에서 찾는다.
    const minimumNodeCount =
      ruleMatch.graphOperation === 'append-leading' ||
      ruleMatch.graphOperation === 'separate-arrow-lines' ||
      ruleMatch.graphOperation === 'append-tail'
        ? 1
        : 2
    if (nodes.length < minimumNodeCount) {
      this.logger.warn(`[front-rule][taskflow-graph] reqId=${ctx.reqId} 노드 캡처 부족으로 draft 생성 생략`)
      return null
    }

    const singleAttach =
      ruleMatch.graphOperation === 'attach-child' || ruleMatch.graphOperation === 'attach-right'
    if (singleAttach || ruleMatch.graphOperation === 'append-tail') {
      const newNodeName = singleAttach ? String(nodes[1] ?? '') : String(nodes[0] ?? '')
      const anchorOk = singleAttach ? this.canvasNameExists(ctx, String(nodes[0] ?? ''), 'canvas') : true
      const stepOk = this.canvasNameExists(ctx, newNodeName, 'palette')

      if (!anchorOk || !stepOk) {
        this.logger.warn(
          `[front-rule][taskflow-graph] reqId=${ctx.reqId} 이름 확인 실패로 룰 처리 생략 anchorOk=${anchorOk} stepOk=${stepOk} nodes=${JSON.stringify(nodes)}`,
        )
        return null
      }
    }

    // 기준 노드에 하나만 붙이는 룰. attach-child 는 왼쪽 핸들(자식), attach-right 는 오른쪽 핸들(다음 순서)이다.
    // "두번째 Parallel" 같은 말로 센 순번은 프론트가 읽는 "이름 #N" 으로 바꿔 넘긴다.
    const anchorName = await this.normalizeNodeTargetName(routeKey, String(nodes[0] ?? ''))
    const attachHandle = ruleMatch.graphOperation === 'attach-child' ? 'left' : 'right'
    const insertAfter = ruleMatch.graphOperation === 'append-tail'
      // 기준을 비우면 프론트가 Start 로부터 이어진 순차 흐름의 꼬리(자식 제외)를 찾아 그 우측에 붙인다.
      // Start 만 있는 캔버스에서는 Start 우측이 된다.
      ? [
          {
            after: '',
            step: resolveTaskAlias(String(nodes[0] ?? '')),
            appendOnly: true,
            sourceHandle: 'right',
            targetHandle: 'left',
          },
        ]
      : ruleMatch.graphOperation === 'attach-child' || ruleMatch.graphOperation === 'attach-right'
      ? [
          {
            after: anchorName,
            step: resolveTaskAlias(String(nodes[1] ?? '')),
            appendOnly: true,
            sourceHandle: attachHandle,
            targetHandle: 'left',
          },
        ]
      : arrowLines.length > 0
      ? arrowLines.flatMap((line) => line.labels.map((label, index) => {
          if (index === 0) {
            return { after: '', step: label, isolated: true, sourceHandle: 'right', targetHandle: 'left' }
          }

          const separatorIndex = line.hasLeadingArrow ? index : index - 1
          const separator = line.separators[separatorIndex] ?? '->'
          const vertical = separator === '=>' || separator === '⇒'
          return {
            after: line.labels[index - 1],
            step: label,
            appendOnly: true,
            sourceHandle: vertical ? 'left' : 'right',
            targetHandle: 'left',
          }
        }))
      : nodes.map((label, index) => (
          index === 0
            ? { after: '', step: label, appendOnly: true, sourceHandle: 'right', targetHandle: 'left' }
            : { after: nodes[index - 1], step: label, appendOnly: true, sourceHandle: 'right', targetHandle: 'left' }
        ))

    const canvasDraft = {
      mode: 'edit' as const,
      insertAfter,
    }

    const screen = getScreenConfig(routeKey)
    const connectionText = arrowLines.length > 0
      ? arrowLines.map((line) => line.labels.join(' -> ')).join('\n')
      : nodes.join(' -> ')
    // 문구는 rule.reply_text 를 쓴다. {{nodes}} 는 연결 대상, {{anchor}}/{{node}} 는 기준/추가 노드다.
    const replyTemplate = String(
      (ruleMatch.toolArgs?.replyText as string | undefined) ?? ruleMatch.rule?.replyText ?? '',
    ).trim()
    const text = replyTemplate
      ? replyTemplate
          .replace(/\{\{\s*nodes\s*\}\}/g, connectionText)
          .replace(/\{\{\s*anchor\s*\}\}/g, ruleMatch.graphOperation === 'append-tail' ? '' : String(nodes[0] ?? ''))
          .replace(
            /\{\{\s*node\s*\}\}/g,
            ruleMatch.graphOperation === 'append-tail' ? String(nodes[0] ?? '') : String(nodes[1] ?? nodes[0] ?? ''),
          )
      : `${connectionText} 연결을 캔버스에 반영했습니다.`

    const reply: ChatReply = {
      chat_action: ruleMatch.chatAction || screen?.chatActions.action || 'action',
      chat_action_param: {
        ...(ruleMatch.chatActionParam ?? {}),
        matchedRuleKey: ruleMatch.ruleKey,
        canvasDraft,
      },
      text,
    }

    reply.pipelineConfidence = this.normalizeRuleConfidence(ruleMatch.confidence)
    reply.matchedRule = {
      source: 'front-rule',
      ruleKey: ruleMatch.ruleKey,
      ruleType: ruleMatch.ruleType,
      reason: ruleMatch.reason,
      confidence: this.normalizeRuleConfidence(ruleMatch.confidence),
    }

    this.logger.warn(
      `[front-rule][taskflow-graph] reqId=${ctx.reqId} draft=${JSON.stringify(canvasDraft)}`,
    )

    await this.saveLog(ctx.body, reply, ctx, this.buildChatLogDebugMeta(ctx, reply, {
      pipelineIntent: 'action',
      pipelineConfidence: ruleMatch.confidence,
      pipelineTrace: `front-rule:${ruleMatch.ruleKey}`,
    }, 'front-rule'))

    this.stageLog('3단계:룰우선처리', 'served', `taskflow-graph 룰로 캔버스 draft 응답(ruleKey=${ruleMatch.ruleKey})`, ctx.reqId)
    return reply
  }

  private async tryFrontRuleEngine(ctx: ChatContext): Promise<ChatReply | null> {
    const matchedRouteKey = findNearestRegisteredRouteKey(ctx.key, ctx.reqId, this.logger) ?? ctx.key
    this.logger.warn(
      `[front-rule] reqId=${ctx.reqId} ctxKey=${ctx.key} matchedRouteKey=${matchedRouteKey} currentPath=${ctx.currentPath || '-'} message="${ctx.message}"`,
    )
    const ruleMatch = await matchFrontRule(
      {
        screenKey: matchedRouteKey,
        message: ctx.message,
      },
      (appKey, screenKey) => this.chatRules.listByAppAndScreen(appKey, screenKey),
    )

    if (!ruleMatch) {
      this.stageLog('3단계:룰우선처리', 'miss', 'front-rule 매칭 없음', ctx.reqId)
      return null
    }

    this.stageLog(
      '3단계:룰우선처리',
      'matched',
      `front-rule 매칭 성공(ruleKey=${ruleMatch.ruleKey}, intent=${ruleMatch.intent})`,
      ctx.reqId,
    )

    if (ruleMatch.intent === 'info') {
      const chunks = this.resolveFrontRuleChunks(matchedRouteKey, ruleMatch.chunkKeys ?? [])
      const text = this.renderFrontRuleTemplate(ruleMatch.answerTemplate, ctx.message, chunks)
      const screen = getScreenConfig(matchedRouteKey)
      const baseActionParam = ruleMatch.chatActionParam && typeof ruleMatch.chatActionParam === 'object'
        ? (ruleMatch.chatActionParam as Record<string, unknown>)
        : {}

      const reply: ChatReply = {
        chat_action: ruleMatch.chatAction || screen?.chatActions.info || 'info',
        chat_action_param: {
          ...baseActionParam,
          matchedRuleKey: ruleMatch.ruleKey,
          usedChunks: chunks.map((row) => row.key),
          usedCollection: chunks[0]?.collection,
        },
        text: text
          || String(ruleMatch.fallbackText ?? '').trim()
          || String(screen?.fallbackText ?? '').trim()
          || '관련 정보를 찾지 못했습니다.',
      }

      reply.usedCollection = chunks[0]?.collection
      reply.primaryChunkKey = chunks[0]?.key
      reply.usedChunks = chunks.map((row) => row.key)
      reply.pipelineConfidence = this.normalizeRuleConfidence(ruleMatch.confidence)
      reply.matchedRule = {
        source: 'front-rule',
        ruleKey: ruleMatch.ruleKey,
        ruleType: ruleMatch.intent,
        reason: ruleMatch.reason,
        confidence: this.normalizeRuleConfidence(ruleMatch.confidence),
      }

      await this.saveLog(ctx.body, reply, ctx, this.buildChatLogDebugMeta(ctx, reply, {
        pipelineIntent: 'info',
        pipelineConfidence: ruleMatch.confidence,
        pipelineTrace: `front-rule:${ruleMatch.ruleKey}`,
      }, 'front-rule'))

      return reply
    }

    const canvasReply = await this.buildTaskflowGraphRuleReply(ctx, matchedRouteKey, ruleMatch)
    if (canvasReply) return canvasReply

    const toolName = String(ruleMatch.toolName ?? '').trim()
    if (!toolName) {
      if (ruleMatch.chatAction) {
        const screen = getScreenConfig(matchedRouteKey)
        const baseActionParam = ruleMatch.chatActionParam && typeof ruleMatch.chatActionParam === 'object'
          ? (ruleMatch.chatActionParam as Record<string, unknown>)
          : {}
        const directReplyText = String(
          (ruleMatch.toolArgs && typeof ruleMatch.toolArgs === 'object' && 'replyText' in ruleMatch.toolArgs
            ? ruleMatch.toolArgs.replyText
            : '') ?? '',
        ).trim()
        const reply: ChatReply = {
          chat_action: ruleMatch.chatAction,
          chat_action_param: {
            ...baseActionParam,
            matchedRuleKey: ruleMatch.ruleKey,
          },
          text: directReplyText
            || String(ruleMatch.fallbackText ?? '').trim()
            || String(screen?.fallbackText ?? '').trim()
            || '요청을 처리합니다.',
        }
        reply.pipelineConfidence = this.normalizeRuleConfidence(ruleMatch.confidence)
        reply.matchedRule = {
          source: 'front-rule',
          ruleKey: ruleMatch.ruleKey,
          ruleType: ruleMatch.ruleType,
          reason: ruleMatch.reason,
          confidence: this.normalizeRuleConfidence(ruleMatch.confidence),
        }

        await this.saveLog(ctx.body, reply, ctx, this.buildChatLogDebugMeta(ctx, reply, {
          pipelineIntent: 'action',
          pipelineConfidence: ruleMatch.confidence,
          pipelineTrace: `front-rule:${ruleMatch.ruleKey}`,
        }, 'front-rule'))

        return reply
      }

      this.stageLog('3단계:룰우선처리', 'miss', `action 룰에 toolName 없음(ruleKey=${ruleMatch.ruleKey})`, ctx.reqId)
      return null
    }

    const tool = this.resolveRuleTool(matchedRouteKey, toolName)
    if (!tool) {
      this.stageLog('3단계:룰우선처리', 'miss', `tool 미등록(toolName=${toolName})`, ctx.reqId)
      return null
    }

    const toolCtx = buildToolContextFromBody({
      body: {
        ...ctx.body,
        routeKey: matchedRouteKey,
        screenRouteKey: matchedRouteKey,
      },
      message: ctx.message,
      log: {
        log: (m) => this.logger.log(m),
        error: (m) => this.logger.error(m),
      },
    })

    try {
      const toolResult = await tool.execute({ ...(ruleMatch.toolArgs ?? {}) }, toolCtx)
      const reply = this.buildRuleFirstActionReply(matchedRouteKey, ruleMatch, toolName, toolResult)
      reply.pipelineConfidence = this.normalizeRuleConfidence(ruleMatch.confidence)
      reply.matchedRule = {
        source: 'front-rule',
        ruleKey: ruleMatch.ruleKey,
        ruleType: ruleMatch.intent,
        reason: ruleMatch.reason,
        confidence: this.normalizeRuleConfidence(ruleMatch.confidence),
      }

      await this.saveLog(ctx.body, reply, ctx, this.buildChatLogDebugMeta(ctx, reply, {
        pipelineIntent: 'action',
        pipelineConfidence: ruleMatch.confidence,
        pipelineTrace: `front-rule:${ruleMatch.ruleKey}`,
      }, 'front-rule'))

      return ensurePeriodInEventReply(reply)
    } catch (e: any) {
      this.logger.debug(`[front-rule] tool execute failed rule=${ruleMatch.ruleKey} tool=${toolName} err=${e?.message ?? String(e)}`)
      this.stageLog('3단계:룰우선처리', 'error', `tool 실행 실패(rule=${ruleMatch.ruleKey})`, ctx.reqId)
      return null
    }
  }

  /** 기존 화면 안내(guidance) 처리. */
  private async handleGuidance(ctx: ChatContext): Promise<ChatReply> {
    const commonSystem = getPromptStore()?.getPromptContent('common', 'system') ?? ''
    const routeKey = ctx.key
    const routeHint =
      getPromptStore()?.getPromptContent(routeKey, 'intent-hint') ??
      getPromptStore()?.getPromptContent(routeKey, 'data-system') ??
      getPromptStore()?.getPromptContent(routeKey, 'action-system') ??
      ''

    const systemPrompt = [commonSystem, routeHint].filter(Boolean).join('\n\n')
    const messages = systemPrompt
      ? [
        { role: 'system' as const, content: systemPrompt },
        ...ctx.history,
        { role: 'user' as const, content: ctx.message },
      ]
      : [...ctx.history, { role: 'user' as const, content: ctx.message }]

    this.logger.log(
      `[chat] [reqId=${ctx.reqId}] status=fallback reason=guidance 경로에서 기본 LLM 호출`,
    )
    this.logger.log(
      `[chat] [trace][reqId=${ctx.reqId}] route=${routeKey || '-'} promptMeta={commonSystem:${commonSystem.length}, routeHint:${routeHint.length}, routeHintApplied:${Boolean(routeHint)}}`,
    )

    const result = await ctx.llm.client.generateContent({
      messages,
      maxOutputTokens: ctx.llm.maxOutputTokens,
    })

    const text = result?.text?.trim()
    const finalText = text || ''

    if (!text) {
      this.logger.debug(
        `[chat] guidance-empty-text route=${routeKey || '-'} fallbackApplied=false`,
      )
    }

    const reply: ChatReply = {
      chat_action: routeKey || 'default',
      text: finalText,
    }

    await this.saveLog(ctx.body, reply, ctx, this.buildChatLogDebugMeta(ctx, reply, undefined, 'guidance'))

    return reply
  }

  private buildChatLogDebugMeta(
    ctx: ChatContext,
    reply: ChatReply,
    meta?: Record<string, unknown>,
    source: 'orchestrator' | 'rule-first' | 'guidance' | 'front-rule' = 'orchestrator',
  ): ChatLogDebugMeta | undefined {
    const reqId = String(ctx?.reqId ?? '').trim() || undefined
    const pipelineIntent = String(meta?.pipelineIntent ?? '').trim().toLowerCase() || undefined
    const pipelineTrace = String(reply?.pipelineTrace ?? '').trim() || undefined
    const pipelineConfidence = Number(reply?.pipelineConfidence)
    const usedCollection = String(reply?.usedCollection ?? '').trim() || undefined
    const actionRagCollection = String(meta?.['actionRagCollection'] ?? '').trim() || undefined
    const primaryChunkKey = String(reply?.primaryChunkKey ?? '').trim() || undefined
    const assistantText = String(reply?.text ?? '').trim()
    const usedChunks = Array.isArray(reply?.usedChunks)
      ? reply.usedChunks.map((item) => String(item ?? '').trim()).filter(Boolean)
      : Array.isArray(meta?.['actionRagChunks'])
        ? (meta['actionRagChunks'] as unknown[]).map((item) => String(item ?? '').trim()).filter(Boolean)
        : []
    const ragScores = Array.isArray(reply?.ragScores) ? reply.ragScores : []
    const selectedRagScore = usedCollection
      ? ragScores.find((item) => String(item?.collection ?? '').trim() === usedCollection)
      : undefined
    const ragMatchScoreRaw = Number(selectedRagScore?.topScore)
    const ragAdjustedScoreRaw = Number(selectedRagScore?.adjustedScore)
    const screenTask = String(meta?.screenTask ?? '').trim() || undefined
    const isOrchestratorSource = source === 'orchestrator'
    const defaultLlmFallback = isOrchestratorSource
      ? Boolean(meta?.defaultLlmFallback)
      : undefined
    const llmAttempted = isOrchestratorSource && pipelineIntent === 'info'
      ? (usedChunks.length === 0 || Boolean(defaultLlmFallback))
      : undefined
    const infoTextMissing = isOrchestratorSource && pipelineIntent === 'info'
      ? assistantText.length === 0
      : undefined
    const suggestedActionsAttached = reply?.chat_action_param && typeof reply.chat_action_param === 'object'
      ? Array.isArray((reply.chat_action_param as Record<string, unknown>)?.suggested_actions)
        && ((reply.chat_action_param as Record<string, unknown>).suggested_actions as unknown[]).length > 0
      : undefined
    const emptyTextReason = infoTextMissing
      ? defaultLlmFallback
        ? 'info-llm-empty-text'
        : usedChunks.length === 0
          ? 'info-rag-miss-no-llm-text'
          : 'info-rag-empty-text'
      : undefined
    const ragMinScoreRaw = Number(this.pipelineCfg.infoRagMinScore)
    const ragMinScore = isOrchestratorSource && Number.isFinite(ragMinScoreRaw)
      ? ragMinScoreRaw
      : undefined
    const ragSelectionRule = isOrchestratorSource
      ? 'topScore >= minScore, rank by adjustedScore'
      : undefined
    const executed = Array.isArray(meta?.executed) ? meta.executed : []
    const loginUser = this.resolveLoginUser(ctx?.body)
    const matchedRule = reply?.matchedRule && typeof reply.matchedRule === 'object'
      ? (reply.matchedRule as MatchedRuleInfo)
      : undefined

    const debugMeta: ChatLogDebugMeta = {
      reqId,
      pipelineIntent,
      pipelineConfidence: Number.isFinite(pipelineConfidence) ? pipelineConfidence : undefined,
      pipelineTrace,
      screenTask,
      defaultLlmFallback,
      llmAttempted,
      infoTextMissing,
      emptyTextReason,
      suggestedActionsAttached,
      ragMatchScore: Number.isFinite(ragMatchScoreRaw) ? ragMatchScoreRaw : undefined,
      ragAdjustedScore: Number.isFinite(ragAdjustedScoreRaw) ? ragAdjustedScoreRaw : undefined,
      ragThresholdScore: ragMinScore,
      ragMinScore,
      ragSelectionRule,
      usedCollection: usedCollection || actionRagCollection,
      actionRagCollection: actionRagCollection || usedCollection,
      primaryChunkKey,
      usedChunks: usedChunks.length > 0 ? usedChunks : undefined,
      actionRagChunks: usedChunks.length > 0 ? usedChunks : undefined,
      ragScores: ragScores.length > 0 ? ragScores : undefined,
      executed: executed.length > 0 ? executed : undefined,
      fallbackReason: String(meta?.fallbackReason ?? '').trim() || undefined,
      discardedText: String(meta?.discardedText ?? '').trim() || undefined,
      loginUser,
      source,
      matchedRule,
    }

    // 룰/RAG/guidance 등 어느 경로로 응답했든 같은 자리에서 흐름 판단값을 확정한다.
    markFlowDecision(reqId, {
      ruleEvaluated: true,
      ruleMatched: Boolean(matchedRule),
      ruleStage: matchedRule?.source ?? source,
      ruleReason: matchedRule?.reason,
      intent: pipelineIntent,
      intentConfidence: Number.isFinite(pipelineConfidence) ? pipelineConfidence : undefined,
      handler:
        source === 'front-rule'
          ? 'front-rule'
          : source === 'guidance'
            ? 'guidance'
            : source === 'rule-first'
              ? 'rule-first'
              : undefined,
      // ragUsed/ragRole 은 실제 처리 경로(handleInfo/handleExecution)가 이미 채웠으면 그 값을 남긴다.
      ragUsed: usedChunks.length > 0 ? true : undefined,
      ragUsedCollection: usedCollection || actionRagCollection,
      ragTopScore: Number.isFinite(ragMatchScoreRaw) ? ragMatchScoreRaw : undefined,
      ragMinScore,
    })
    debugMeta.flowTrace = readFlowTrace(reqId)

    const hasValues = Object.values(debugMeta).some((value) => value !== undefined)
    return hasValues ? debugMeta : undefined
  }

  private async saveLog(body: any, reply: ChatReply, ctx?: ChatContext, debugMeta?: ChatLogDebugMeta) {
    if (body && typeof body === 'object') body.__chatLogSaved = true
    const author = ctx?.author || this.resolveAuthor(body)
    const conversationId =
      ctx?.conversationId ||
      this.resolveConversationId(body)

    await this.chatLog.save({
      author: author || undefined,
      conversationId: conversationId || undefined,
      currentApp: this.normalize(body.currentApp) || undefined,
      currentPath: this.normalize(body.currentPath) || undefined,
      chatAction: reply.chat_action,
      userMessage: this.normalize(body.message) || undefined,
      assistantText: reply.text,
      debugMeta,
    })
  }
}