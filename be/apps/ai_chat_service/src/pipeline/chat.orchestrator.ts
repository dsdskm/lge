/**
 * 탭 챗봇 오케스트레이터.
 *
 * 화면(routeKey)에 등록된 ScreenConfig 기준으로 pipeline intent를 분류하고,
 * info(RAG) / action(통합 tool 실행) 경로로 처리한다.
 *
 * 주의:
 * - screenTask: ChatService에서 화면별로 먼저 분류한 사용자 작업 단위
 *   예) list, analyze, recommend_action, run_action, create, update
 *
 * - pipelineIntent: Orchestrator 내부에서 처리 경로를 정하기 위한 분기 단위
 *   예) info, action 
 */

import { Logger } from '@nestjs/common'

import type { LlmClient } from '../llm/llm.types'
import type { ToolContext, ToolDefinition } from './tool.type'
import { IntentClassifier } from './intent.classifier'
import { RagService } from './rag/rag.service'
import {
  includesConfiguredPhrase,
  loadTaskflowClassifierRules,
  loadTaskflowOrchestratorRules,
  type TaskflowClassifierRules,
  type TaskflowOrchestratorRules,
} from './taskflow-language-rules'
import { ToolAgent, type ExecutedCall } from './agent/tool-agent'
import { getScreenConfig, type ScreenConfig } from './screen-registry'
import { readCurrentGraphFromContext, readTaskContentsFromContext, toMatchKey } from './tools/taskflow-palette'
import { getPropertyTmsStore } from '../features/taskflow/service/property-tms-store.service'
import type { ChatIntent, ChatReply, ChatTurn, RagScoreEntry } from './pipeline.types'
import type { ChatPipelineConfig } from './pipeline.config'
import { getPromptStore } from '../features/chat/service/prompt-store.service'
import { CHAT_PROMPT_TYPE } from '../features/chat/prompt-types'
import { getChatSettingService } from '../features/chat-settings/service/chat-setting.service'
import { renderMessage } from './message-bundle.util'
import { trace } from './trace.util'
import { markFlowDecision, recordFlowStep } from './flow-trace'
import { TASKFLOW_MESSAGE_KEY } from './tools/taskflow-message'
import { logLlmPromptMeta } from '../utils/utils'
import { buildToolContextFromBody } from './tool-context.util'

const COMMON_COLLECTION = 'common'

export type OrchestrationOutput = {
  handled: boolean
  reply?: ChatReply
  meta?: Record<string, unknown>
}

type NavigationResult = {
  path: string
  app?: string
  screenName?: string
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

type FallbackIntentConfig = {
  actionKeywords: string[]
  actionScreenTasks: ScreenTask[]
}

/** 프론트에서 실행할 clientAction 이 응답 안에 있는지. 도구 결과가 한 겹 더 들어오는 경우도 본다. */
function hasClientAction(param: unknown): boolean {
  if (!param || typeof param !== 'object') return false

  const row = param as Record<string, any>
  if (row.clientAction && typeof row.clientAction === 'object') return true

  return hasClientAction(row.toolResult)
}

// 규칙은 전부 rule 테이블에서 온다. 행이 없으면 비교 대상이 없어 그 규칙은 매칭되지 않는다.
const EMPTY_CLASSIFIER_RULES: TaskflowClassifierRules = {
  explanationKeywords: [],
  composeRequestKeywords: [],
  composeMoveHintKeywords: [],
  editSubjectKeywords: [],
  editVerbKeywords: [],
  explanationBlockKeywords: [],
  arrowSequenceEnabled: false,
  explanationImageMinScore: 0,
  explanationImageMinScoreAlways: 0,
  nodeEditDeletePrefixes: [],
  arrowChainSeparators: [],
  concurrentHintKeywords: [],
  actionRequestKeywords: [],
  clauseSeparatorPhrases: [],
  clauseNoisePhrases: [],
  composeBlockPhrases: [],
}

export class ChatOrchestrator {
  /**
   * pipeline intent 분류기.
   *
  * 여기서 말하는 intent는 화면별 세부 작업이 아니라,
  * 최종 처리 경로(info 또는 action 우선순위)를 정하는 기준이다.
   */
  private readonly classifier: IntentClassifier
  private readonly rag: RagService
  private readonly agent: ToolAgent

  constructor(
    private readonly client: LlmClient,
    private readonly maxOutputTokens: number,
    private readonly pipeline: ChatPipelineConfig,
    private readonly logger = new Logger(ChatOrchestrator.name),
  ) {
    ;(this.logger as unknown as { log: (...args: any[]) => void }).log = () => undefined
    ;(this.logger as unknown as { debug: (...args: any[]) => void }).debug = () => undefined
    this.classifier = new IntentClassifier(this.client, this.maxOutputTokens)
    this.rag = new RagService(
      this.client,
      this.maxOutputTokens,
      {
        topK: pipeline.ragTopK,
        minScore: pipeline.infoRagMinScore,
        screenBonus: pipeline.infoRagScreenBonus,
      },
      logger,
    )
    this.agent = new ToolAgent(this.client, this.maxOutputTokens, pipeline.maxToolTurns, logger)
  }

  private resolveReqId(body?: any): string {
    return String(body?.reqId ?? body?.requestId ?? '').trim() || '-'
  }

  /** 콘솔로는 남기지 않되, 채팅 내역에 보여 줄 흐름 기록에는 단계별로 쌓는다. */
  private stageLog(stage: string, reqId: string, detail?: string) {
    const text = String(detail ?? '').trim()
    const status = text.match(/status=([^\s]+)/)?.[1] ?? ''
    const reason = text.match(/reason=(.*)$/)?.[1]?.trim() ?? ''

    recordFlowStep(reqId, stage, {
      ...(status ? { status } : {}),
      ...(reason ? { reason } : {}),
    })
  }

  private async generateDefaultLlmReply(
    screen: ScreenConfig,
    message: string,
    history: ChatTurn[],
    reason: string,
    reqId = '-',
  ): Promise<string | undefined> {
    const systemPrompt = String(screen.dataSystemPrompt ?? '').trim()

    this.logger.debug(
      `================= [5단계:기본LLM_폴백] [reqId=${reqId}] status=fallback reason=${reason}`,
    )

    this.logger.log(
      `================= [5단계:기본LLM_폴백_추적] [reqId=${reqId}] route=${screen.key} systemPromptLen=${systemPrompt.length}`,
    )

    logLlmPromptMeta({
      stage: 'default-llm-fallback',
      promptType: 'fallback',
      route: screen.key,
      appKey: screen.appKey,
      systemPromptLen: systemPrompt.length,
      messageLen: String(message ?? '').length,
      historyTurns: history.length,
      toolCount: 0,
      isToolCall: false,
    })

    const res = await this.client.generateContent({
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: message },
      ],
      maxOutputTokens: this.maxOutputTokens,
    })

    const text = (res?.text ?? '').trim()
    return text || undefined
  }

  private decideFallbackIntent(
    message: string,
    canRunAction: boolean,
    screenTask: ScreenTask | undefined,
    config: FallbackIntentConfig,
  ): ChatIntent {
    const text = String(message ?? '').toLowerCase()
    const actionKeywords = config.actionKeywords
    const actionRequested = actionKeywords.some((keyword) => text.includes(keyword))

    const actionScreenTask = new Set<ScreenTask>(config.actionScreenTasks)
    if (canRunAction && screenTask && actionScreenTask.has(screenTask)) {
      return 'action'
    }

    if (canRunAction && actionRequested) {
      return 'action'
    }

    return 'info'
  }

  private normalizeActionKeywords(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    const normalized = raw
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter(Boolean)
    return Array.from(new Set(normalized))
  }

  private normalizeActionScreenTasks(raw: unknown): ScreenTask[] {
    if (!Array.isArray(raw)) return []

    const allowed = new Set<ScreenTask>([
      'unknown',
      'guide',
      'list',
      'search',
      'summary',
      'analyze',
      'recommend_action',
      'run_action',
      'settings',
      'create',
      'update',
      'delete',
    ])

    const normalized = raw
      .map((item) => String(item ?? '').trim() as ScreenTask)
      .filter((item) => allowed.has(item))

    return Array.from(new Set(normalized))
  }

  private async resolveFallbackIntentConfig(screenKey: string): Promise<FallbackIntentConfig> {
    const settings = getChatSettingService()
    if (!settings) {
      // 설정 서비스가 없으면 보정 근거가 없다. 코드 기본값을 두지 않아 설정 누락이 드러나게 한다.
      console.warn('[intent-fallback] chat setting service unavailable. intentFallback.* 설정을 읽지 못했다.')
      return { actionKeywords: [], actionScreenTasks: [] }
    }

    const routeKey = String(screenKey ?? '').trim()
    const screenKeywordKey = routeKey ? `intentFallback.${routeKey}.actionKeywords` : ''
    const screenTaskKey = routeKey ? `intentFallback.${routeKey}.actionScreenTasks` : ''

    const [screenKeywordsRaw, globalKeywordsRaw, screenTasksRaw, globalTasksRaw] = await Promise.all([
      screenKeywordKey ? settings.get(screenKeywordKey) : Promise.resolve(undefined),
      settings.get('intentFallback.actionKeywords'),
      screenTaskKey ? settings.get(screenTaskKey) : Promise.resolve(undefined),
      settings.get('intentFallback.actionScreenTasks'),
    ])

    const screenKeywords = this.normalizeActionKeywords(screenKeywordsRaw)
    const globalKeywords = this.normalizeActionKeywords(globalKeywordsRaw)
    const screenTasks = this.normalizeActionScreenTasks(screenTasksRaw)
    const globalTasks = this.normalizeActionScreenTasks(globalTasksRaw)

    return {
      actionKeywords: screenKeywords.length > 0 ? screenKeywords : globalKeywords,
      actionScreenTasks: screenTasks.length > 0 ? screenTasks : globalTasks,
    }
  }

  private findLatestAssistantTurn(history: ChatTurn[]): string {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.role !== 'assistant') continue
      const content = String(history[i]?.content ?? '').trim()
      if (content) return content
    }
    return ''
  }

  private hasOrchestratorPhrase(text: string, phrases: string[]): boolean {
    return includesConfiguredPhrase(text, Array.isArray(phrases) ? phrases : [])
  }

  private isTaskflowNodeClarificationPrompt(text: string, rules: TaskflowOrchestratorRules): boolean {
    const value = String(text ?? '').trim()
    if (!value) return false
    return this.hasOrchestratorPhrase(value, rules.nodeClarificationPhrases)
  }

  private looksLikeNodeNameOnlyAnswer(text: string, rules: TaskflowOrchestratorRules): boolean {
    const value = String(text ?? '').trim()
    if (!value) return false
    if (value.length > Number(rules.nodeNameOnlyMaxLength ?? 40)) return false
    if (/[?？]/.test(value)) return false
    if (this.hasOrchestratorPhrase(value, rules.nodeNameBlockedPhrases)) {
      return false
    }
    return /[\p{L}\p{N}]/u.test(value)
  }

  private isTaskflowDeleteClarificationPrompt(text: string, rules: TaskflowOrchestratorRules): boolean {
    const value = String(text ?? '').trim()
    if (!value) return false
    return this.hasOrchestratorPhrase(value, rules.nodeDeleteClarificationPhrases)
  }

  private isTaskflowModeClarificationPrompt(text: string, rules: TaskflowOrchestratorRules): boolean {
    const value = String(text ?? '').trim()
    if (!value) return false
    return this.hasOrchestratorPhrase(value, rules.modeClarificationPhrases)
  }

  private isTaskflowSaveClarificationPrompt(text: string, rules: TaskflowOrchestratorRules): boolean {
    const value = String(text ?? '').trim()
    if (!value) return false
    return this.hasOrchestratorPhrase(value, rules.saveClarificationPhrases)
  }

  private hasClassifierPhrase(text: string, phrases: string[]): boolean {
    return includesConfiguredPhrase(text, Array.isArray(phrases) ? phrases : [])
  }

  private buildContinuationMessage(
    message: string,
    history: ChatTurn[],
    screen: ScreenConfig,
    taskflowClassifierRules: TaskflowClassifierRules,
    taskflowOrchestratorRules: TaskflowOrchestratorRules,
    currentPath?: string,
    lastAssistantMessage?: string,
    reqId = '-',
  ): string {
    const raw = String(message ?? '').trim()
    if (!raw) return raw

    const normalizedPath = String(currentPath ?? '').trim()
    const isTmsTaskflowCanvas = /^\/?tms\/taskflows\/[^/]+\/canvas(?:\/|$)/.test(
      normalizedPath.replace(/^\/+/, ''),
    )
    if (!isTmsTaskflowCanvas) return raw

    const hasComposeTaskflowTool = screen.actionTools.some(
      (tool) => tool?.declaration?.name === 'compose_linear_taskflow',
    )
    if (!hasComposeTaskflowTool) return raw

    const latestAssistant = String(lastAssistantMessage ?? '').trim() || this.findLatestAssistantTurn(history)
    if (this.looksLikeTaskflowEditMessage(raw, taskflowClassifierRules)) return raw

    let merged = ''
    if (this.isTaskflowNodeClarificationPrompt(latestAssistant, taskflowOrchestratorRules)) {
      merged = /노드/i.test(raw)
        ? `${raw} ${taskflowOrchestratorRules.nodeAppendSuffix}`.trim()
        : `${raw} ${taskflowOrchestratorRules.nodeAppendWithNodeSuffix}`.trim()
    } else if (this.isTaskflowDeleteClarificationPrompt(latestAssistant, taskflowOrchestratorRules)) {
      merged = /노드/i.test(raw)
        ? `${raw} ${taskflowOrchestratorRules.deleteAppendSuffix}`.trim()
        : `${raw} ${taskflowOrchestratorRules.deleteAppendWithNodeSuffix}`.trim()
    } else if (this.isTaskflowModeClarificationPrompt(latestAssistant, taskflowOrchestratorRules)) {
      merged = `${raw} ${taskflowOrchestratorRules.modeAppendSuffix}`.trim()
    } else if (this.isTaskflowSaveClarificationPrompt(latestAssistant, taskflowOrchestratorRules)) {
      merged = /임시\s*저장/i.test(raw)
        ? taskflowOrchestratorRules.saveTempMessage
        : taskflowOrchestratorRules.saveFinalMessage
    } else if (
      this.looksLikeNodeNameOnlyAnswer(raw, taskflowOrchestratorRules)
      && this.isTaskflowNodeClarificationPrompt(latestAssistant, taskflowOrchestratorRules)
    ) {
      merged = /노드/i.test(raw)
        ? `${raw} ${taskflowOrchestratorRules.nodeAppendSuffix}`.trim()
        : `${raw} ${taskflowOrchestratorRules.nodeAppendWithNodeSuffix}`.trim()
    }

    if (!merged) return raw
    this.stageLog(
      '2-2단계:멀티턴_문맥복원',
      reqId,
      'status=rewritten reason=이전 clarification 문맥을 반영해 후속 발화를 실행 가능 문장으로 변환',
    )
    this.logger.log(`================= [2-2단계:멀티턴_문맥복원_추적] [reqId=${reqId}] original=${raw} effective=${merged}`)
    return merged
  }

  private uniqueCollections(collections: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const raw of collections) {
      const key = String(raw ?? '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(key)
    }

    return result
  }

  private isGuideLikeInfoQuery(message: string, rules: TaskflowOrchestratorRules): boolean {
    const text = String(message ?? '').trim().toLowerCase()
    if (!text) return false

    const hasInfoCue = this.hasOrchestratorPhrase(text, rules.guideInfoCuePhrases)
    if (!hasInfoCue) return false

    const hasActionCue = this.hasOrchestratorPhrase(text, rules.guideActionCuePhrases)
    return !hasActionCue
  }

  private looksLikeNodeUsageGuideQuery(message: string, rules: TaskflowOrchestratorRules): boolean {
    const text = String(message ?? '').trim()
    if (!text) return false
    if (!this.hasOrchestratorPhrase(text, rules.nodeGuideSubjectPhrases)) return false
    return this.hasOrchestratorPhrase(text, rules.nodeGuideRequestPhrases)
  }

  private resolveNodeGuideFallbackChunkKeys(): string[] {
    const configured = Array.isArray(this.pipeline.infoNodeGuideFallbackChunkKeys)
      ? this.pipeline.infoNodeGuideFallbackChunkKeys
      : []
    const seen = new Set<string>()
    const result: string[] = []

    for (const raw of configured) {
      const key = String(raw ?? '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(key)
    }

    return result
  }

  /**
   * 등록된 화면이면 처리하고, 아니면 handled:false로 반환한다.
   * handled:false는 ChatService에서 guidance fallback으로 이어진다.
   */
  async handle(routeKey: string, message: string, body: any): Promise<OrchestrationOutput> {
    const reqId = this.resolveReqId(body)
    const screen = getScreenConfig(routeKey, reqId)
    this.stageLog(
      '2단계:화면설정_확정',
      reqId,
      `status=${screen ? 'resolved' : 'not-found'} reason=routeKey 기준 화면 설정 조회`,
    )
    if (!screen) {
      return { handled: false }
    }

    this.logger.log(
      `================= [2단계:화면설정_확정_추적] [reqId=${reqId}] route=${routeKey} screenKey=${screen.key} appKey=${screen.appKey} dataTools=${screen.dataTools.length} actionTools=${screen.actionTools.length} ragCollection=${screen.ragCollection}`,
    )

    const [taskflowClassifierRules, taskflowOrchestratorRules] = await Promise.all([
      loadTaskflowClassifierRules(screen.key),
      loadTaskflowOrchestratorRules(screen.key),
    ])

    const history = normalizeHistory(body?.history)
    const latestAssistantMessage = String(body?.lastAssistantMessage ?? '').trim() || undefined
    const effectiveMessage = this.buildContinuationMessage(
      message,
      history,
      screen,
      taskflowClassifierRules,
      taskflowOrchestratorRules,
      String(body?.currentPath ?? '').trim() || undefined,
      latestAssistantMessage,
      reqId,
    )
    const screenTask = this.normalizeScreenTask(body?.screenTask)
    this.stageLog('2-0단계:요청요약', reqId, `status=received reason=screen=${screen.key} query=${effectiveMessage}`)
    this.stageLog('2-1단계:화면작업_입력', reqId, `status=loaded reason=screenTask=${screenTask}`)
    const previousFilters =
      body?.previousFilters && typeof body.previousFilters === 'object'
        ? (body.previousFilters as Record<string, unknown>)
        : undefined
    this.stageLog('2-2단계:이전필터_입력', reqId, `status=checked reason=previousFilters=${Boolean(previousFilters)}`)
    const canvasNodeNames = this.readCanvasNodeNames(body)
    const ruleFirstIntentResult = this.resolveRuleFirstIntent(
      screen,
      effectiveMessage,
      screenTask,
      taskflowClassifierRules,
      taskflowOrchestratorRules,
      canvasNodeNames,
    )

    const pipelineIntentResult = ruleFirstIntentResult ?? await this.classifier.classify(
      effectiveMessage,
      screen.key,
      screen.intentClassifierPrompt,
      history,
      reqId,
    )

    if (ruleFirstIntentResult) {
      this.stageLog(
        '2-3단계:의도분류_룰우선',
        reqId,
        `status=matched reason=intent=${ruleFirstIntentResult.intent}, confidence=${ruleFirstIntentResult.confidence}`,
      )
    }
    this.stageLog(
      '2-3단계:의도분류_원결과',
      reqId,
      `status=classified reason=intent=${pipelineIntentResult.intent}, confidence=${pipelineIntentResult.confidence}`,
    )

    this.logger.log(
      `================= [2-3단계:의도분류_원결과_추적] [reqId=${reqId}] reasonText=${pipelineIntentResult.reason}`,
    )

    const fallbackIntentConfig = await this.resolveFallbackIntentConfig(screen.key)

    let pipelineIntent: ChatIntent = pipelineIntentResult.intent
    let infoRagCollections = this.uniqueCollections([COMMON_COLLECTION, screen.ragCollection, screen.appKey])
    const actionRagCollections = this.uniqueCollections([screen.ragCollection, screen.appKey, COMMON_COLLECTION])
    this.stageLog('2-4단계:의도분류_초안', reqId, `status=drafted reason=초기 의도=${pipelineIntent}`)
    // 의도 분석 실패(저신뢰도) 시 common action 또는 common RAG로 우선 복구한다.
    if (pipelineIntentResult.confidence < this.pipeline.intentMinConfidence) {
      pipelineIntent = this.decideFallbackIntent(
        effectiveMessage,
        screen.actionTools.length > 0,
        screenTask,
        fallbackIntentConfig,
      )
      this.stageLog(
        '2-5단계:저신뢰도_보정',
        reqId,
        `status=adjusted reason=저신뢰도(${pipelineIntentResult.confidence})로 fallbackIntent=${pipelineIntent} 적용`,
      )
    }

    const hasComposeTaskflowTool = screen.actionTools.some(
      (tool) => tool?.declaration?.name === 'compose_linear_taskflow',
    )
    const shouldForceTaskflowAction =
      hasComposeTaskflowTool &&
      this.looksLikeTaskflowEditMessage(effectiveMessage, taskflowClassifierRules, canvasNodeNames)

    if (shouldForceTaskflowAction && pipelineIntent !== 'action') {
      pipelineIntent = 'action'
      this.stageLog(
        '2-6-1단계:태스크플로우의도_강제',
        reqId,
        'status=forced reason=compose_linear_taskflow 대상 발화로 판단되어 action 파이프라인으로 강제 전환',
      )
    }

    if (String(pipelineIntent).toLowerCase() === 'data') {
      pipelineIntent = 'action'
      this.stageLog(
        '2-6-2단계:데이터의도_통합',
        reqId,
        'status=merged reason=data intent를 action 처리 경로로 통합',
      )
    }

    // 룰이 이미 편집 요청으로 판정했으면 guide 로 되돌리지 않는다.
    // 콘텐츠 이름에 '설명' 같은 말이 들어가면 screenTask 가 guide 로 잡혀 캔버스 편집이 통째로 막힌다.
    const shouldForceInfoIntent =
      !shouldForceTaskflowAction
      && (screenTask === 'guide' || this.isGuideLikeInfoQuery(effectiveMessage, taskflowOrchestratorRules))
    if (shouldForceInfoIntent && pipelineIntent !== 'info') {
      pipelineIntent = 'info'
      this.stageLog(
        '2-6-3단계:가이드의도_강제',
        reqId,
        'status=forced reason=방법/설명/가이드성 질의로 판단되어 info(RAG) 경로로 강제 전환',
      )
    }

    const settings = getChatSettingService()
    const actionRagHasMatch = this.retrieveActionRagContext(actionRagCollections, effectiveMessage).usedChunks.length > 0
    // 캔버스 편집은 RAG 문서가 아니라 도구가 처리한다. 도구가 실패하면 그때 RAG 로 되돌린다.
    if (pipelineIntent === 'action' && !actionRagHasMatch && !hasComposeTaskflowTool) {
      pipelineIntent = 'info'
      this.stageLog(
        '2-6-4단계:액션RAG_미매칭_정보폴백',
        reqId,
        'status=fallBack reason=action 인텐트용 RAG 문서가 없어 info 경로로 전환',
      )
    }

    this.stageLog(
      '2-6단계:최종의도_확정',
      reqId,
      `status=confirmed reason=screenTask=${screenTask}, intent=${pipelineIntent}, infoRagCollectionCount=${infoRagCollections.length}`,
    )
    this.stageLog(
      '2-7단계:의도요약',
      reqId,
      `status=classified reason=${pipelineIntent === 'action' ? '액션 요청' : '정보 문의'}`,
    )

    this.logger.log(
      `================= [2-6단계:최종의도_확정_추적] [reqId=${reqId}] confidence=${pipelineIntentResult.confidence} classifierReason=${pipelineIntentResult.reason} infoRagCollections=${infoRagCollections.join(',')}`,
    )

    markFlowDecision(reqId, {
      ruleEvaluated: true,
      ruleMatched: Boolean(ruleFirstIntentResult || shouldForceTaskflowAction),
      ruleStage: 'orchestrator',
      ruleReason: ruleFirstIntentResult
        ? String(ruleFirstIntentResult.reason ?? '')
        : shouldForceTaskflowAction
          ? 'forced: compose_linear_taskflow taskflow-action heuristic'
          : 'rule-first:no-match',
      ruleKeys: ruleFirstIntentResult?.ruleKeys,
      intent: pipelineIntent,
      intentConfidence: Number.isFinite(pipelineIntentResult.confidence)
        ? pipelineIntentResult.confidence
        : undefined,
      intentSource: ruleFirstIntentResult
        ? 'rule-first'
        : shouldForceTaskflowAction
          ? 'forced-taskflow'
          : shouldForceInfoIntent
            ? 'forced-guide'
            : pipelineIntentResult.confidence < this.pipeline.intentMinConfidence
              ? 'low-confidence-fallback'
              : 'llm',
    })

    trace(reqId, '2.intent', {
      route: screen.key,
      message: effectiveMessage,
      intent: pipelineIntent,
      confidence: pipelineIntentResult.confidence,
      forcedByRule: shouldForceTaskflowAction,
      actionTools: screen.actionTools.map((tool) => tool.declaration.name),
      canvasNodes: canvasNodeNames.length,
    })

    const toolCtx = this.buildToolCtx(body, effectiveMessage)

    let output: OrchestrationOutput
    switch (pipelineIntent) {
      case 'action':
        output = await this.handleExecution(
          screen,
          effectiveMessage,
          toolCtx,
          taskflowClassifierRules,
          pipelineIntentResult,
          history,
          screenTask,
          previousFilters,
          actionRagCollections,
          reqId,
        )

        // 캔버스에서 taskflow 구성/수정을 아무것도 못 만들었으면 정적 안내 대신 RAG 답변으로 되돌린다.
        // 단, 편집 요청 자체는 RAG 문서가 "추가했습니다" 로 답해버려 안 한 일을 한 것처럼 보이므로 제외한다.
        if (hasComposeTaskflowTool && output.meta?.fallbackTextUsed === true && !shouldForceTaskflowAction) {
          this.stageLog(
            '3-3단계:태스크플로우_RAG폴백',
            reqId,
            'status=fallBack reason=taskflow 도구가 캔버스를 바꾸지 못해 info(RAG) 응답으로 대체',
          )
          output = await this.handleInfo(
            screen,
            effectiveMessage,
            taskflowOrchestratorRules,
            pipelineIntentResult,
            history,
            screenTask,
            infoRagCollections,
            reqId,
          )
        }
        break

      case 'info':
      default:
        output = await this.handleInfo(
          screen,
          effectiveMessage,
          taskflowOrchestratorRules,
          pipelineIntentResult,
          history,
          screenTask,
          infoRagCollections,
          reqId,
        )
        break
    }

    const ruleMatched = Boolean(ruleFirstIntentResult || shouldForceTaskflowAction)
    const ruleReason = ruleFirstIntentResult
      ? String(ruleFirstIntentResult.reason ?? '').trim()
      : shouldForceTaskflowAction
        ? 'forced: compose_linear_taskflow taskflow-action heuristic'
        : 'rule-first:no-match'

    output.meta = {
      ...(output.meta && typeof output.meta === 'object' ? output.meta : {}),
      ruleEvaluated: true,
      ruleMatched,
      ruleReason: ruleReason || undefined,
      ruleStage: 'orchestrator',
    }

    if ((ruleFirstIntentResult || shouldForceTaskflowAction) && output.reply) {
      const matchedReason = ruleFirstIntentResult
        ? String(ruleFirstIntentResult.reason ?? '').trim()
        : 'forced: compose_linear_taskflow taskflow-action heuristic'
      const matchedConfidence = ruleFirstIntentResult
        ? (Number.isFinite(Number(ruleFirstIntentResult.confidence))
          ? Number(ruleFirstIntentResult.confidence)
          : undefined)
        : undefined

      const matchedRuleKeys = ruleFirstIntentResult?.ruleKeys ?? []
      output.reply.matchedRule = {
        // rule 테이블의 rule_key 를 그대로 보여 준다. 어떤 룰 때문에 이렇게 갈렸는지 바로 알 수 있게.
        ruleKey: matchedRuleKeys.length > 0 ? matchedRuleKeys.join(' + ') : 'taskflow-action-heuristic',
        ruleType: 'taskflow-classifier',
        source: 'orchestrator',
        reason: matchedReason || undefined,
        confidence: matchedConfidence,
      }
    }

    const chatAction = String(output?.reply?.chat_action ?? '-')
    const hasParam = Boolean(output?.reply?.chat_action_param)
    const hasDraft = hasClientAction(output?.reply?.chat_action_param)
    this.stageLog(
      '6단계:최종반환_요약',
      reqId,
      `status=returned reason=handled=${Boolean(output?.handled)} chatAction=${chatAction} hasParam=${hasParam} hasDraft=${hasDraft}`,
    )
    trace(reqId, '6.reply', {
      chatAction,
      hasParam,
      hasClientAction: hasDraft,
      clientAction: (output?.reply?.chat_action_param as any)?.clientAction?.name
        ?? (output?.reply?.chat_action_param as any)?.toolResult?.clientAction?.name
        ?? '-',
      text: output?.reply?.text,
      fallbackTextUsed: output?.meta?.fallbackTextUsed,
    })

    return output
  }

  private normalizeScreenTask(value: unknown): ScreenTask {
    const raw = String(value ?? 'unknown').trim()

    switch (raw) {
      case 'guide':
      case 'list':
      case 'search':
      case 'summary':
      case 'analyze':
      case 'recommend_action':
      case 'run_action':
      case 'settings':
      case 'create':
      case 'update':
      case 'delete':
        return raw

      case 'unknown':
      default:
        return 'unknown'
    }
  }

  private buildToolCtx(body: any, message?: string): ToolContext {
    return buildToolContextFromBody({
      body,
      message,
      actionRunnerUrl: this.pipeline.actionRunnerUrl,
      log: {
        log: (m) => this.logger.log(m),
        error: (m) => this.logger.error(m),
      },
    })
  }

  private findNavigationResult(executed: ExecutedCall[]): NavigationResult | undefined {
    for (const call of executed) {
      if (call.error) continue
      const result = call.result
      if (!result || typeof result !== 'object') continue

      const path = String((result as Record<string, unknown>).path ?? '').trim().replace(/^\/+/, '')
      if (!path) continue

      const app = String((result as Record<string, unknown>).app ?? '').trim() || undefined
      return { path, app }
    }

    return undefined
  }

  private normalizeForMatch(value: unknown): string {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
  }

  private inferNavigationFromScreenName(message: string, currentApp: string): NavigationResult | undefined {
    const store = getPromptStore()
    const screens = store?.getEnabledScreens() ?? []
    const normalizedMessage = this.normalizeForMatch(message)
    if (!normalizedMessage) return undefined

    const candidates = screens
      .map((screen) => {
        const normalizedScreenName = this.normalizeForMatch(screen.screenName)
        if (!normalizedScreenName) return undefined
        if (!normalizedMessage.includes(normalizedScreenName)) return undefined

        return {
          key: screen.screenKey,
          appKey: screen.appKey,
          screenName: screen.screenName,
          nameLen: normalizedScreenName.length,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => {
        const appPriorityA = a.appKey === currentApp ? 0 : 1
        const appPriorityB = b.appKey === currentApp ? 0 : 1
        if (appPriorityA !== appPriorityB) return appPriorityA - appPriorityB
        if (a.nameLen !== b.nameLen) return b.nameLen - a.nameLen
        return a.key.localeCompare(b.key)
      })

    const best = candidates[0]
    if (!best) return undefined

    return {
      path: best.key,
      app: best.appKey,
      screenName: best.screenName,
    }
  }

  /** 편집 요청 여부만 필요할 때. 어떤 rule_key 로 판정했는지는 evaluateTaskflowEditMessage 를 쓴다. */
  private looksLikeTaskflowEditMessage(
    message: string,
    rules?: TaskflowClassifierRules,
    canvasNodeNames: string[] = [],
  ): boolean {
    return this.evaluateTaskflowEditMessage(message, rules, canvasNodeNames).matched
  }

  /**
   * 캔버스 편집 요청인지 판정하고, 판정에 쓰인 rule 테이블의 rule_key 를 함께 돌려준다.
   * 채팅 내역의 "매칭 룰" 에 이 키가 그대로 표시되므로, 어떤 룰 때문에 이렇게 갈렸는지 바로 알 수 있다.
   */
  private evaluateTaskflowEditMessage(
    message: string,
    rules?: TaskflowClassifierRules,
    canvasNodeNames: string[] = [],
  ): { matched: boolean; ruleKeys: string[] } {
    const text = String(message ?? '').trim()
    if (!text) return { matched: false, ruleKeys: [] }

    const safeRules = rules ?? EMPTY_CLASSIFIER_RULES

    if (this.hasClassifierPhrase(text, safeRules.explanationBlockKeywords ?? [])) {
      return { matched: false, ruleKeys: ['explanationBlockKeywords'] }
    }

    // 설명 요청 문구는 rule 테이블(explanationKeywords)에서만 온다.
    // 콘텐츠 이름에 '설명' 이 들어가는 경우가 있어 코드에 문구를 박아 두면 편집 요청까지 막힌다.
    const isExplanationQuestion = this.hasClassifierPhrase(text, safeRules.explanationKeywords ?? [])
      && !this.hasClassifierPhrase(text, safeRules.composeRequestKeywords ?? [])
      && !this.hasClassifierPhrase(text, safeRules.editVerbKeywords ?? [])
    if (isExplanationQuestion) {
      return { matched: false, ruleKeys: ['explanationKeywords'] }
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

    const deletePrefixes = Array.isArray(safeRules.nodeEditDeletePrefixes) ? safeRules.nodeEditDeletePrefixes : []
    const arrowSeps = Array.isArray(safeRules.arrowChainSeparators) ? safeRules.arrowChainSeparators : []

    const hasDeletePrefix = lines.some((line) =>
      deletePrefixes.some((p) => new RegExp(`(?:^|[\\s,;])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\w가-힣]`).test(line)),
    )
    if (hasDeletePrefix) return { matched: true, ruleKeys: ['nodeEditDeletePrefixes'] }

    const hasArrowChain = lines.some((line) => arrowSeps.some((sep) => line.includes(sep)))
    if (hasArrowChain) return { matched: true, ruleKeys: ['arrowChainSeparators'] }

    const hasArrowSequenceByRule =
      Boolean(safeRules.arrowSequenceEnabled)
      && this.hasClassifierPhrase(text, safeRules.composeMoveHintKeywords ?? [])
    if (hasArrowSequenceByRule) return { matched: true, ruleKeys: ['arrowSequenceEnabled', 'composeMoveHintKeywords'] }

    const subjectKeys: string[] = []
    if (this.hasClassifierPhrase(text, safeRules.editSubjectKeywords ?? [])) {
      subjectKeys.push('editSubjectKeywords')
    } else if (this.mentionsCanvasNode(text, canvasNodeNames)) {
      // "PlaySound 지워줘" 처럼 캔버스에 있는 노드 이름을 직접 부르면 그 이름이 곧 대상이다.
      subjectKeys.push('canvasNodeName')
    } else {
      return { matched: false, ruleKeys: ['editSubjectKeywords'] }
    }

    if (this.hasClassifierPhrase(text, safeRules.editVerbKeywords ?? [])) {
      return { matched: true, ruleKeys: [...subjectKeys, 'editVerbKeywords'] }
    }

    // "A 장소 이동해서 B 발화하고 ... 돌아오게 해줘" 처럼 편집 동사 없이 동작만 나열한 요청.
    // 이런 문장을 놓치면 info(RAG) 로 새 나가 "구성했습니다" 라고만 답하고 캔버스는 그대로 남는다.
    // 여기까지 왔으면 편집 대상(editSubject) 또는 실제 캔버스/팔레트 노드 이름이 이미 문장에 있다.
    // 그래서 동시 실행 문구가 없어도 동작 요청 문구만으로 편집 요청으로 본다.
    const hasActionRequest = this.hasClassifierPhrase(text, safeRules.actionRequestKeywords ?? [])
    return {
      matched: hasActionRequest,
      ruleKeys: [...subjectKeys, 'actionRequestKeywords'],
    }
  }

  private mentionsCanvasNode(message: string, canvasNodeNames: string[]): boolean {
    const key = toMatchKey(message)
    if (!key) return false

    return canvasNodeNames.some((name) => {
      const nameKey = toMatchKey(name)
      return nameKey.length >= 2 && key.includes(nameKey)
    })
  }

  /** 사용자가 노드를 부를 때 쓰는 말. 캔버스 노드 + 팔레트 콘텐츠 + Task 이름/표현. */
  private readCanvasNodeNames(body: any): string[] {
    const graph = readCurrentGraphFromContext(body?.context)
    const contents = readTaskContentsFromContext(body?.context)
    const tasks = getPropertyTmsStore()?.list() ?? []

    return [
      ...graph.nodes.flatMap((node) => [node.label, node.taskName, node.contentName]),
      ...contents.map((row) => row.contentName),
      ...tasks.flatMap((task) => [task.taskName, ...task.triggerPhrases]),
    ].filter((name): name is string => Boolean(name))
  }

  private resolveRuleFirstIntent(
    screen: ScreenConfig,
    message: string,
    screenTask: ScreenTask,
    classifierRules: TaskflowClassifierRules,
    orchestratorRules: TaskflowOrchestratorRules,
    canvasNodeNames: string[] = [],
  ): { intent: ChatIntent; confidence: number; reason: string; ruleKeys?: string[] } | null {
    const text = String(message ?? '').trim()
    if (!text) return null

    const hasComposeTaskflowTool = screen.actionTools.some(
      (tool) => tool?.declaration?.name === 'compose_linear_taskflow',
    )
    if (!hasComposeTaskflowTool) return null

    // 편집 패턴을 먼저 본다. guide 판정은 화면 단계에서 키워드 하나로도 붙어서,
    // 먼저 검사하면 "A 이동하고 B 발화해줘" 같은 편집 요청이 info 로 새 나간다.
    const editEvaluation = this.evaluateTaskflowEditMessage(text, classifierRules, canvasNodeNames)
    if (editEvaluation.matched) {
      return {
        intent: 'action',
        confidence: Number(orchestratorRules.ruleFirstIntentConfidence) || 0,
        reason: 'rule-first: taskflow edit pattern matched',
        ruleKeys: editEvaluation.ruleKeys,
      }
    }

    if (screenTask === 'guide' || this.isGuideLikeInfoQuery(text, orchestratorRules)) {
      return {
        intent: 'info',
        confidence: Number(orchestratorRules.ruleFirstIntentConfidence) || 0,
        reason: 'rule-first: guide/info cue matched',
      }
    }

    return null
  }

  private async tryDeterministicTaskflowDraft(
    screen: ScreenConfig,
    message: string,
    toolCtx: ToolContext,
    rules: TaskflowClassifierRules,
    canvasNodeNames: string[] = [],
  ): Promise<Record<string, unknown> | undefined> {
    const composeTool = screen.actionTools.find((tool) => tool?.declaration?.name === 'compose_linear_taskflow')
    if (!composeTool) return undefined
    // 판정은 의도 분류와 같은 기준을 쓴다. 노드 이름만 부른 요청("Angry 얼굴 표시해줘")도 편집 요청이다.
    if (!this.looksLikeTaskflowEditMessage(message, rules, canvasNodeNames)) return undefined

    // "지워줘", "바꿔줘" 처럼 있는 노드를 고치라는 요청은 새로 만드는 경로가 가로채면 안 된다.
    // (compose 는 노드를 추가하므로 삭제 요청에 노드가 하나 늘어난다.) 표현은 rule 테이블에서 온다.
    if (this.hasClassifierPhrase(message, rules?.composeBlockPhrases ?? [])) {
      this.stageLog(
        '4단계:결정적드래프트_생략',
        this.resolveReqId((toolCtx as any)?.body),
        'status=skipped reason=기존 노드를 고치는 요청이라 compose 결정적 경로를 태우지 않는다',
      )
      return undefined
    }

    try {
      const result = await composeTool.execute({}, toolCtx)
      if (!result || typeof result !== 'object') return undefined

      const objectResult = result as Record<string, unknown>
      const hasCanvasDraft = hasClientAction(objectResult)
      const hasClarification = String(objectResult.clarification ?? '').trim().length > 0

      if (!hasCanvasDraft && !hasClarification) return undefined

      if (hasCanvasDraft) {
        this.logger.log(`[prompt-apply] route=${screen.key} deterministic-taskflow-draft-applied=true`)
        this.stageLog(
          '4단계:결정적드래프트_적용',
          this.resolveReqId((toolCtx as any)?.body),
          'status=applied reason=compose_linear_taskflow 결과에 clientAction이 포함되어 우선 적용',
        )
      } else {
        this.stageLog(
          '4단계:결정적드래프트_명확화',
          this.resolveReqId((toolCtx as any)?.body),
          'status=blocked reason=compose_linear_taskflow 결과에 clarification이 포함되어 사용자 입력 안내 반환',
        )
      }

      return {
        toolName: 'compose_linear_taskflow',
        toolResult: objectResult,
      }
    } catch (e: any) {
      this.logger.debug(`[prompt-apply] route=${screen.key} deterministic-taskflow-draft-failed err=${e?.message ?? String(e)}`)
      return undefined
    }
  }

  private async handleInfo(
    screen: ScreenConfig,
    message: string,
    taskflowOrchestratorRules: TaskflowOrchestratorRules,
    pipelineIntentResult: unknown,
    history: ChatTurn[],
    screenTask: ScreenTask,
    ragCollections: string[],
    reqId: string,
  ): Promise<OrchestrationOutput> {
    this.stageLog('3단계:INFO처리_RAG조회', reqId, `status=running reason=정보성 질의로 RAG 우선 조회`)
    this.logger.log(
      `================= [3단계:INFO처리_RAG조회_추적] [reqId=${reqId}] route=${screen.key} ragCollections=${ragCollections.join(',')}`,
    )

    // response chain:
    // 1. screen/app RAG collection
    // 2. common RAG collection
    // 3. default LLM
    const primary = await this.rag.answer(
      ragCollections,
      message,
      history,
      reqId,
      { intentType: 'info', appKey: screen.appKey, screenKey: screen.key },
    )

    let text = primary.text
    let usedCollection = primary.usedCollection
    let primaryChunkKey = primary.primaryChunkKey
    let usedChunks = primary.usedChunks
    let ragScores = primary.ragScores

    const shouldTryNodeGuideFallback =
      this.looksLikeNodeUsageGuideQuery(message, taskflowOrchestratorRules) &&
      (usedChunks.length === 0 || !String(text ?? '').trim())

    if (shouldTryNodeGuideFallback) {
      const fallbackChunkKeys = this.resolveNodeGuideFallbackChunkKeys()
      if (fallbackChunkKeys.length > 0) {
        const fallback = await this.rag.answerFromChunkKeys(
          ragCollections,
          fallbackChunkKeys,
          message,
          history,
          reqId,
          { intentType: 'info', appKey: screen.appKey, screenKey: screen.key },
        )

        ragScores = [...ragScores, ...fallback.ragScores]

        if (fallback.usedChunks.length > 0 && String(fallback.text ?? '').trim()) {
          text = fallback.text
          usedCollection = fallback.usedCollection
          primaryChunkKey = fallback.primaryChunkKey
          usedChunks = fallback.usedChunks
        }
      }
    }

    const ragBodyFallback = usedChunks.length > 0
      ? this.resolveUsedChunkBodyText(ragCollections, usedChunks)
      : ''
    const fallbackText = text || ''
    const usesRagBodyFallback = this.shouldUseRagBodyFallback(fallbackText, ragBodyFallback)
    const finalText = this.sanitizeInfoFinalText(
      usesRagBodyFallback
        ? ragBodyFallback
        : fallbackText,
      usedCollection,
    )
    const finalFallbackText = (usedChunks.length === 0 || !finalText)
      ? await getChatSettingService()?.getFinalFallbackText()
      : ''
    const ragInfoMeta = getPromptStore()?.getPromptMeta('common', CHAT_PROMPT_TYPE.ragInfo)
    this.logger.log(
      `######## INFO RAG 실행 결과 ########\n[reqId=${reqId}]\n- selectedCollection: ${usedCollection ?? '-'}\n- selectedChunks: ${usedChunks.join(', ') || '-'}\n- common/instruction: ${getPromptStore()?.getPromptMeta('common', CHAT_PROMPT_TYPE.instruction)?.id ?? '-'}\n- common/rag-info: ${ragInfoMeta?.id ?? '-'}\n- ragInfoEnabled: ${ragInfoMeta?.enabled ?? false}\n- llmResponse: ${JSON.stringify(fallbackText)}\n- ragBodyFallbackUsed: ${usesRagBodyFallback}\n- finalResponse: ${JSON.stringify(finalFallbackText || finalText)}\n######################################`,
    )
    this.logger.log(
      `[rag-diagnosis] [reqId=${reqId}] stage=finalize usedCollection=${usedCollection ?? '-'} usedChunks=${JSON.stringify(usedChunks)} rawLlmText=${JSON.stringify(fallbackText)} ragBodyFallback=${JSON.stringify(ragBodyFallback)} usesRagBodyFallback=${usesRagBodyFallback} finalFallbackText=${JSON.stringify(finalFallbackText)} finalText=${JSON.stringify(finalFallbackText || finalText)}`,
    )

    const selectedRagScore = usedCollection
      ? ragScores.find((row) => String(row?.collection ?? '').trim() === usedCollection)
      : undefined
    markFlowDecision(reqId, {
      handler: 'rag',
      // info 경로에서는 RAG 문서가 답변의 근거다.
      ragRole: usedChunks.length > 0 ? 'answer' : 'unused',
      ragUsed: usedChunks.length > 0,
      ragUsedCollection: usedCollection,
      ragTopScore: Number.isFinite(Number(selectedRagScore?.topScore)) ? Number(selectedRagScore?.topScore) : undefined,
      ragMinScore: Number.isFinite(Number(this.pipeline.infoRagMinScore))
        ? Number(this.pipeline.infoRagMinScore)
        : undefined,
    })

    return {
      handled: true,
      reply: {
        chat_action: screen.chatActions.info,
        text: finalFallbackText || finalText,
      },
      meta: {
        screenTask,
        pipelineIntent: 'info',
        pipelineIntentResult,
        ragCollections,
        usedCollection,
        primaryChunkKey,
        usedChunks,
        ragScores,
        defaultLlmFallback: false,
        finalFallbackTextUsed: Boolean(finalFallbackText),
      },
    }
  }

  private shouldUseRagBodyFallback(text: string, ragBodyFallback: string): boolean {
    const raw = String(text ?? '').trim()
    const fallback = String(ragBodyFallback ?? '').trim()
    if (!fallback) return false
    if (!raw) return true

    const looksLikeDeveloperStructuredJson = /^\s*\{.*\"(intent|confidence|reason|summary|message)\"\s*:/is.test(raw)
    return looksLikeDeveloperStructuredJson
  }

  private resolveUsedChunkBodyText(collectionNames: string[], chunkIds: string[]): string {
    const store = getPromptStore()
    if (!store) return ''

    const selected = new Set(chunkIds.map((chunkId) => String(chunkId ?? '').trim()).filter(Boolean))
    const fragments: string[] = []

    for (const collectionName of collectionNames) {
      const collection = store.getCollection(collectionName)
      if (!collection) continue

      for (const chunk of collection.chunks) {
        if (!selected.has(String(chunk.id ?? '').trim())) continue
        const body = String(chunk.body ?? '').trim()
        if (body) fragments.push(body)
      }
    }

    return fragments.join('\n\n').trim()
  }

  private sanitizeInfoFinalText(value: string, usedCollection?: string): string {
    const raw = String(value ?? '').trim()
    if (!raw) return ''

    const hasStructuredBody = (text: string): boolean => {
      if (!text) return false
      if (text.length < 20) return false
      return /\n/.test(text) || /(^#|^[-*]\s|^\d+\)|!\[|```|Taskflow|태스크\s*플로우|태스크플로우)/im.test(text)
    }

    // RAG miss 문구가 상단에 붙은 뒤 실제 설명 본문이 이어지는 경우, 안내 문구만 제거한다.
    // 예: "죄송합니다. 제공된 문서에는 ... 정보가 없습니다." + "Taskflow 기본 구성 ..."
    const leadNoDocPattern = /^죄송합니다\.\s*제공된\s*문서에는\s*[^\n.!?]*정보가\s*없습니다\.?\s*/i
    if (leadNoDocPattern.test(raw)) {
      const strippedNoDoc = raw.replace(leadNoDocPattern, '').trim()
      if (strippedNoDoc.length >= 12) {
        return strippedNoDoc
      }
    }

    // 화면별 info RAG 응답에서 "저는 ... 처리할 수 있습니다." 류의 선행 문구가
    // 본문 앞에 자동으로 붙는 경우가 있어, 본문이 충분하면 선행 문장만 제거한다.
    // 공통 컬렉션/폴백 문구까지 과도하게 제거하지 않도록 화면 컬렉션일 때만 적용한다.
    const isScreenCollection = Boolean(usedCollection && usedCollection !== 'common')
    if (isScreenCollection) {
      const leadCapabilityPattern = /^저는\s+[^\n]{0,120}?(?:할\s*수\s*있습니다|해드릴\s*수\s*있습니다|지원합니다|가능합니다)\.?\s*/i
      if (leadCapabilityPattern.test(raw)) {
        const strippedCapability = raw.replace(leadCapabilityPattern, '').trim()
        if (hasStructuredBody(strippedCapability)) {
          return strippedCapability
        }
      }
    }

    return raw
  }

  private async handleExecution(
    screen: ScreenConfig,
    message: string,
    toolCtx: ToolContext,
    taskflowClassifierRules: TaskflowClassifierRules,
    pipelineIntentResult: unknown,
    history: ChatTurn[],
    screenTask: ScreenTask,
    previousFilters: Record<string, unknown> | undefined,
    actionRagCollections: string[],
    reqId = '-',
  ): Promise<OrchestrationOutput> {
    const executionTools = this.resolveExecutionTools(screen)
    const mutatingActionTools = [
      ...screen.actionTools,
      ...(Array.isArray(screen.commonActionTools) ? screen.commonActionTools : []),
    ].filter((tool) => !tool.readOnly)
    const actionToolNames = new Set(mutatingActionTools.map((tool) => tool.declaration.name))
    const hasExecutionTool = executionTools.length > 0
    const actionRag = this.retrieveActionRagContext(actionRagCollections, message)

    if (!hasExecutionTool) {
      const actionReply = await this.rag.answer(
        actionRagCollections,
        message,
        history,
        reqId,
        { intentType: 'action', appKey: screen.appKey, screenKey: screen.key },
      )

      const finalText = actionReply.text?.trim()
        ? this.sanitizeInfoFinalText(actionReply.text, actionReply.usedCollection)
        : this.buildScreenGuidanceReply(screen)

      this.stageLog(
        '3단계:ACTION처리_툴없음',
        reqId,
        `status=${finalText === this.buildScreenGuidanceReply(screen) ? 'fallback' : 'rag'} reason=현재 화면에 실행 가능한 tool이 없음`,
      )

      return {
        handled: true,
        reply: {
          chat_action: screen.chatActions.action,
          text: finalText,
        },
        meta: {
          screenTask,
          pipelineIntent: 'action',
          pipelineIntentResult,
          executed: [],
          fallbackTextUsed: !actionReply.text?.trim(),
          actionRagCollection: actionReply.usedCollection ?? actionRag.usedCollection,
          actionRagChunks: actionReply.usedChunks.length > 0 ? actionReply.usedChunks : actionRag.usedChunks,
          ragScores: actionReply.ragScores.length > 0 ? actionReply.ragScores : actionRag.ragScores,
        },
      }
    }
    if (actionRag.usedChunks.length > 0) {
      this.stageLog(
        '3-0단계:ACTION처리_RAG조회',
        reqId,
        `status=matched reason=collection=${actionRag.usedCollection ?? '-'} hitCount=${actionRag.usedChunks.length}`,
      )
    } else {
      this.stageLog(
        '3-0단계:ACTION처리_RAG조회',
        reqId,
        'status=miss reason=액션 전용 RAG 매칭 결과 없음',
      )
    }

    const systemPrompt = this.buildExecutionPrompt(screen, previousFilters, actionRag.context)

    this.stageLog('3단계:ACTION처리_툴실행', reqId, 'status=running reason=action 통합 경로로 tool 실행')
    this.logger.log(
      `================= [3단계:ACTION처리_툴실행_추적] [reqId=${reqId}] route=${screen.key} promptLen=${systemPrompt.length} toolCount=${executionTools.length}`,
    )

    const { text, executed } = await this.agent.run(
      systemPrompt,
      message,
      executionTools,
      toolCtx,
      history,
    )
    const evaluateExecution = async (executionText: string, executionCalls: ExecutedCall[], source: 'screen' | 'common') => {
      const noExecution = executionCalls.length === 0 || executionCalls.every((call) => Boolean(call.error))
      const deterministicTaskflowParam = await this.tryDeterministicTaskflowDraft(
        screen,
        message,
        toolCtx,
        taskflowClassifierRules,
        this.readCanvasNodeNames((toolCtx as any)?.body),
      )
      const deterministicApplied = Boolean(deterministicTaskflowParam)
      const deterministicClarification = this.extractActionClarification(deterministicTaskflowParam)

      if (deterministicClarification) {
        return {
          handled: true,
          reply: {
            chat_action: screen.chatActions.action,
            chat_action_param: deterministicTaskflowParam,
            text: deterministicClarification,
          },
          meta: {
            screenTask,
            pipelineIntent: 'action',
            pipelineIntentResult,
            executed: summarizeCalls(executionCalls),
            fallbackTextUsed: false,
            actionAttemptSource: source,
          },
        } as OrchestrationOutput
      }

      const inferredNavigation = noExecution
        ? this.inferNavigationFromScreenName(message, screen.appKey)
        : undefined

      const ran = executionCalls.find((c) => c.name === 'run_action')
      const navigation = this.findNavigationResult(executionCalls) ?? inferredNavigation
      const actionParam = deterministicTaskflowParam ?? this.buildActionParam(executionCalls, ran, actionToolNames)
      const clarificationText = this.extractActionClarification(actionParam)
      const assistantToolText = this.extractActionAssistantText(actionParam)
      const successfulActionCall = [...executionCalls].reverse().find((call) => !call.error && actionToolNames.has(call.name))
      const hasSiteAction = Boolean(deterministicApplied || navigation || successfulActionCall)

      const resolvedFilters = pickResolvedFilters(executionCalls)
      const fallbackReason = this.resolveExecutionFallbackReason(executionCalls)
      const fallbackText = this.buildActionUnresolvedReply(fallbackReason)

      if (noExecution && !navigation) {
        this.stageLog('3-2단계:ACTION_폴백텍스트', reqId, `status=fallback reason=${fallbackReason} source=${source}`)
      }

      // 조회 tool 만 돌고 끝나면 모델이 "추가했습니다" 처럼 하지 않은 일을 말한다. 그 문장은 버린다.
      const claimedWithoutAction = !hasSiteAction && !resolvedFilters && executionCalls.length > 0
      if (!hasSiteAction) {
        // 캔버스가 안 바뀌는 대표 원인: 도구 미호출 / 도구가 clientAction 을 못 만듦 / clarification.
        trace(reqId, '3-4.no-site-action', {
          source,
          calls: executionCalls.map((call) => `${call.name}${call.error ? '(error)' : ''}`),
          clarification: clarificationText || '-',
          discardedModelText: executionText?.trim() || '-',
        })
      }
      if (claimedWithoutAction) {
        this.stageLog(
          '3-2단계:ACTION_미실행응답차단',
          reqId,
          `status=blocked reason=변경 tool 미실행(calls=${executionCalls.map((call) => call.name).join(',') || '-'}) source=${source}`,
        )
      }

      const finalText =
        clarificationText ||
        assistantToolText ||
        (navigation ? `${navigation.screenName ?? navigation.path} 화면으로 이동하겠습니다.` : '') ||
        (noExecution || claimedWithoutAction ? fallbackText : '') ||
        executionText?.trim() ||
        (hasSiteAction ? '요청을 처리했습니다.' : '조회 결과를 확인했습니다.')

      markFlowDecision(reqId, {
        handler: deterministicApplied ? 'deterministic-compose' : 'tool',
        toolCalls: executionCalls.map((call) => `${call.name}${call.error ? '(error)' : ''}`),
        // action 경로의 RAG 는 답변이 아니라 도구 프롬프트에 붙는 참고 문서다.
        ragRole: actionRag.usedChunks.length > 0 ? 'context' : 'unused',
        ragUsed: actionRag.usedChunks.length > 0,
        ragUsedCollection: actionRag.usedCollection,
      })

      return {
        handled: true,
        reply: {
          chat_action: navigation
            ? 'navigation'
            : resolvedFilters
              ? screen.chatActions.data
              : screen.chatActions.action,
          chat_action_param: navigation
            ? { path: navigation.path, app: navigation.app }
            : hasSiteAction
              ? actionParam
              : resolvedFilters
                ? { filters: resolvedFilters }
                : undefined,
          text: finalText,
        },
        meta: {
          screenTask,
          pipelineIntent: 'action',
          pipelineIntentResult,
          executed: summarizeCalls(executionCalls),
          hasSiteAction,
          actionRagCollection: actionRag.usedCollection,
          actionRagChunks: actionRag.usedChunks,
          ragScores: actionRag.ragScores,
          actionAttemptSource: source,
          fallbackReason: noExecution && !navigation ? fallbackReason : undefined,
          fallbackTextUsed: Boolean((noExecution || claimedWithoutAction) && !navigation),
          // 가이드 문구로 덮어쓴 모델 답변. 왜 tool 을 안 불렀는지 추적할 단서다.
          discardedText: (noExecution || claimedWithoutAction) ? executionText?.trim() || undefined : undefined,
        },
      } satisfies OrchestrationOutput
    }

    const firstAttempt = await evaluateExecution(text, executed, 'screen')
    if (firstAttempt.reply && firstAttempt.meta && firstAttempt.meta.fallbackTextUsed !== true) {
      return firstAttempt
    }

    const commonActionTools = Array.isArray(screen.commonActionTools) ? screen.commonActionTools : []
    if (commonActionTools.length > 0) {
      this.stageLog(
        '3-1단계:ACTION_공통재시도',
        reqId,
        `status=running reason=screen action 실패 후 common action tool 재시도(commonTools=${commonActionTools.length})`,
      )

      const commonRetryPrompt = [
        systemPrompt,
        '위 action 도구 실행이 실패했다. 이제 공통 action 도구만 기준으로 다시 판단하라.',
        '가능하면 공통 action 도구를 우선 선택하고, 실패하면 그때만 fallback 문구로 내려가라.',
      ].join('\n\n')

      const commonAttempt = await this.agent.run(
        commonRetryPrompt,
        message,
        commonActionTools,
        toolCtx,
        history,
      )

      const commonResult = await evaluateExecution(commonAttempt.text, commonAttempt.executed, 'common')
      if (commonResult.reply) {
        return commonResult
      }
    }

    return firstAttempt
  }

  private buildScreenGuidanceReply(screen: ScreenConfig): string {
    const examples = Array.isArray(screen.guidanceExamples)
      ? screen.guidanceExamples.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []

    if (examples.length > 0) {
      return `아래처럼 요청해보세요.\n${examples.join('\n')}`
    }

    return String(screen.fallbackText ?? '').trim() || '실행 가능한 가이드 문구가 없습니다.'
  }

  /** tool 이 안 불렸거나 실패했을 때 쓰는 답변. 화면과 무관한 예시 문구로 덮어쓰지 않는다. */
  private buildActionUnresolvedReply(reason: ReturnType<ChatOrchestrator['resolveExecutionFallbackReason']>): string {
    switch (reason) {
      case 'missing-params':
        return '요청을 처리하기에 정보가 부족합니다. 대상과 변경 내용을 더 구체적으로 말씀해 주세요.'
      case 'permission-denied':
        return '권한이 없어 요청을 처리하지 못했습니다.'
      case 'tool-execution-failed':
        return '요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
      case 'tool-not-selected':
      default:
        return '요청하신 작업을 확인하지 못했습니다. 어떤 항목을 어떻게 바꿀지 다시 한 번 구체적으로 말씀해 주세요.'
    }
  }

  private retrieveActionRagContext(
    collectionNames: string[] | string,
    query: string,
  ): { context: string; usedCollection?: string; usedChunks: string[]; ragScores: RagScoreEntry[] } {
    const names = Array.isArray(collectionNames)
      ? collectionNames
      : [collectionNames]
    const normalizedNames = Array.from(new Set((names ?? []).map((name) => String(name ?? '').trim()).filter(Boolean)))

    const store = getPromptStore()
    const matchedChunks: Array<{ collection: string; id: string; title: string; body: string }> = []
    const seen = new Set<string>()
    for (const name of normalizedNames) {
      const collection = store?.getCollection(name)
      for (const chunk of collection?.chunks ?? []) {
        const id = String(chunk.id ?? '').trim()
        const intentType = String(chunk.intentType ?? 'both').trim().toLowerCase()
        if (!id || seen.has(id) || (intentType !== 'action' && intentType !== 'both')) continue
        seen.add(id)
        matchedChunks.push({ collection: name, id, title: chunk.title, body: chunk.body })
      }
    }

    if (matchedChunks.length > 0) {
      return {
        context: matchedChunks.map((chunk, index) => `[액션 문서 ${index + 1}] ${chunk.title}\n${chunk.body}`).join('\n\n'),
        usedCollection: matchedChunks[0]?.collection,
        usedChunks: matchedChunks.map((chunk) => chunk.id),
        ragScores: [],
      }
    }

    return { context: '', usedChunks: [], ragScores: [] }
  }

  private resolveExecutionFallbackReason(executed: ExecutedCall[]): 'tool-not-selected' | 'missing-params' | 'permission-denied' | 'tool-execution-failed' {
    if (executed.length === 0) {
      return 'tool-not-selected'
    }

    const errors = executed
      .map((call) => String(call.error ?? '').trim().toLowerCase())
      .filter(Boolean)

    if (errors.length === 0) {
      return 'tool-not-selected'
    }

    if (errors.some((msg) => /401|403|unauthorized|forbidden|permission|권한|인가/.test(msg))) {
      return 'permission-denied'
    }

    if (errors.some((msg) => /missing|required|invalid|argument|args|schema|param|context param missing|필수|파라미터/.test(msg))) {
      return 'missing-params'
    }

    return 'tool-execution-failed'
  }

  private resolveExecutionTools(screen: ScreenConfig): ToolDefinition[] {
    const ordered = [...screen.actionTools, ...screen.dataTools]

    const seen = new Set<string>()
    const unique: ToolDefinition[] = []

    for (const tool of ordered) {
      const name = String(tool?.declaration?.name ?? '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      unique.push(tool)
    }

    return unique
  }

  private buildExecutionPrompt(
    screen: ScreenConfig,
    previousFilters?: Record<string, unknown>,
    actionRagContext?: string,
  ): string {
    const basePrompt = [screen.dataSystemPrompt, screen.actionSystemPrompt].filter(Boolean).join('\n\n')
    const promptBlocks: string[] = [basePrompt]

    const mutatingToolNames = screen.actionTools.filter((tool) => !tool.readOnly).map((tool) => tool.declaration.name)
    if (mutatingToolNames.length > 0) {
      // intent-classifier 와 같은 common -> app -> screen 병합 규칙을 따른다.
      const policyBlocks = this.uniqueCollections([COMMON_COLLECTION, screen.appKey, screen.key])
        .map((scopeKey) =>
          renderMessage(scopeKey, CHAT_PROMPT_TYPE.actionTools, TASKFLOW_MESSAGE_KEY.policy, {
            mutatingTools: mutatingToolNames.join(', '),
          }),
        )
        .filter(Boolean)

      if (policyBlocks.length > 0) {
        promptBlocks.push(policyBlocks.join('\n\n'))
      }
    }

    if (String(actionRagContext ?? '').trim()) {
      const commonRagPrompt = getPromptStore()?.getPromptContent('common', CHAT_PROMPT_TYPE.ragAction) ?? ''
      promptBlocks.push([
        commonRagPrompt,
        '다음은 action 실행 시 참고해야 하는 액션 RAG 문서다.',
        '문서에 나온 파라미터 규칙/정책/우선순위를 가능한 범위에서 tool 인자 구성에 반영하라.',
        String(actionRagContext ?? '').trim(),
      ].filter(Boolean).join('\n\n'))
    }

    if (previousFilters) {
      promptBlocks.push([
        `직전에 적용된 필터(JSON): ${JSON.stringify(previousFilters)}`,
        '사용자가 조건 추가/좁히기/변경을 요청하면 위 필터를 기준으로 병합하되, 유지할 값도 tool 인자로 다시 명시한다. 완전히 새로운 조회면 무시한다.',
      ].join('\n'))
    }

    return promptBlocks.filter(Boolean).join('\n\n')
  }

  private buildActionParam(
    executed: ExecutedCall[],
    ran?: ExecutedCall,
    mutatingToolNames?: Set<string>,
  ): Record<string, unknown> | undefined {
    const succeeded = [...executed].reverse().filter((call) => !call.error)
    // 조회 tool 이 마지막에 불려도 화면에 넣을 값은 변경 tool 의 결과다.
    const successCall =
      (mutatingToolNames ? succeeded.find((call) => mutatingToolNames.has(call.name)) : undefined) ?? succeeded[0]

    if (!successCall) {
      return ran ? { executed: ran.result } : undefined
    }

    const result = successCall.result
    const objectResult = result && typeof result === 'object'
      ? (result as Record<string, unknown>)
      : undefined

    if (objectResult?.chat_action_param && typeof objectResult.chat_action_param === 'object') {
      return objectResult.chat_action_param as Record<string, unknown>
    }

    // 기존 run_action 응답 형식과의 호환을 유지한다.
    if (successCall.name === 'run_action') {
      return { executed: result }
    }

    return {
      toolName: successCall.name,
      toolResult: result,
    }
  }

  private extractActionClarification(actionParam?: Record<string, unknown>): string | undefined {
    if (!actionParam || typeof actionParam !== 'object') return undefined

    const direct = String(actionParam.clarification ?? '').trim()
    if (direct) return direct

    const toolResult =
      actionParam.toolResult && typeof actionParam.toolResult === 'object'
        ? (actionParam.toolResult as Record<string, unknown>)
        : undefined
    if (!toolResult) return undefined

    const nested = String(toolResult.clarification ?? '').trim()
    return nested || undefined
  }

  private extractActionAssistantText(actionParam?: Record<string, unknown>): string | undefined {
    if (!actionParam || typeof actionParam !== 'object') return undefined

    const direct = String(actionParam.assistantText ?? '').trim()
    if (direct) return direct

    const toolResult =
      actionParam.toolResult && typeof actionParam.toolResult === 'object'
        ? (actionParam.toolResult as Record<string, unknown>)
        : undefined
    if (!toolResult) return undefined

    const nested = String(toolResult.assistantText ?? toolResult.message ?? '').trim()
    return nested || undefined
  }
}

/** 프론트가 보낸 history를 안전하게 정규화한다. role/content 검증, 최대 8턴. */
function normalizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((turn: any) => ({
      role: turn?.role === 'assistant' ? 'assistant' : 'user',
      content: String(turn?.content ?? '').trim(),
    }))
    .filter((turn): turn is ChatTurn => Boolean(turn.content))
    .slice(-8)
}

/** query_events가 확정한 필터를 프론트 반환용으로 추출한다. 마지막 호출을 우선한다. */
function pickResolvedFilters(executed: ExecutedCall[]): Record<string, unknown> | undefined {
  for (let i = executed.length - 1; i >= 0; i -= 1) {
    const result = executed[i].result as any

    if (executed[i].name === 'query_events' && result?.resolvedFilters) {
      return result.resolvedFilters
    }
  }

  return undefined
}

function summarizeCalls(executed: ExecutedCall[]) {
  return executed.map((call) => ({
    name: call.name,
    args: call.args,
    error: call.error,
  }))
}