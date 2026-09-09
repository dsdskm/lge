/**
 * 한 채팅 요청이 지나간 모든 단계를 하나의 구조체로 모은다.
 *
 * trace() 가 남기는 콘솔 로그는 서버 콘솔을 볼 수 있는 사람만 읽을 수 있어서,
 * 같은 내용을 reqId 단위로 누적해 chat_log.debug_meta.flowTrace 로 내려보낸다.
 * 채팅 내역 화면은 이 값만 보고 "룰 매칭인지 / RAG 인지 / info·action 인지 / 점수는 얼마인지" 를 그린다.
 *
 * 단계 이름(stage)은 서버가 정하고, 사람이 읽는 라벨은 프론트가 붙인다.
 */

export type FlowStepStatus = 'ok' | 'skip' | 'fallback' | 'fail'

export type FlowStep = {
  seq: number
  /** '2.intent' 처럼 trace() 에 쓰는 단계 키. */
  stage: string
  status: FlowStepStatus
  elapsedMs: number
  detail: Record<string, string>
}

/** 단계별 기록을 요약한 판단 결과. 화면 상단 칩으로 그대로 쓴다. */
export type FlowDecisions = {
  /** 룰 평가를 했는지 / 매칭됐는지. */
  ruleEvaluated?: boolean
  ruleMatched?: boolean
  ruleStage?: string
  ruleReason?: string
  /** 판정에 쓰인 rule 테이블의 rule_key 목록. */
  ruleKeys?: string[]
  /** 최종 intent 와 분류 신뢰도. */
  intent?: string
  intentConfidence?: number
  /** intent 를 누가 정했는지. rule-first / llm / low-confidence-fallback / forced-taskflow / forced-guide */
  intentSource?: string
  /** 응답을 만든 경로. rag / tool / deterministic-compose / guidance / front-rule */
  handler?: string
  ragUsed?: boolean
  /** RAG 문서가 어떻게 쓰였는지. answer=답변 근거, context=도구 프롬프트 참고, unused=미사용 */
  ragRole?: 'answer' | 'context' | 'unused'
  ragUsedCollection?: string
  ragTopScore?: number
  ragMinScore?: number
  toolCalls?: string[]
  /** 캔버스 초안에 만들어진 노드/엣지 수. */
  draftNodeCount?: number
  draftEdgeCount?: number
}

export type ChatFlowTrace = {
  reqId: string
  route?: string
  message?: string
  startedAt: string
  totalMs: number
  decisions: FlowDecisions
  steps: FlowStep[]
}

type FlowRecord = {
  reqId: string
  startedAtMs: number
  startedAt: string
  route?: string
  message?: string
  decisions: FlowDecisions
  steps: FlowStep[]
}

const FLOW_LIMIT = 200
const STEP_LIMIT = 120

/** reqId -> 진행 중/직전 기록. 요청이 끝나면 응답에 담아 내보내고 버퍼에서 밀려 사라진다. */
const flows = new Map<string, FlowRecord>()

function normalizeReqId(reqId: unknown): string {
  return String(reqId ?? '-').trim() || '-'
}

function ensureFlow(reqId: string): FlowRecord {
  const key = normalizeReqId(reqId)
  const found = flows.get(key)
  if (found) return found

  const now = Date.now()
  const created: FlowRecord = {
    reqId: key,
    startedAtMs: now,
    startedAt: new Date(now).toISOString(),
    decisions: {},
    steps: [],
  }

  flows.set(key, created)
  if (flows.size > FLOW_LIMIT) {
    const oldest = flows.keys().next().value
    if (oldest !== undefined) flows.delete(oldest)
  }

  return created
}

/** 단계 상태는 detail 의 status 표기에서 뽑는다. trace() 가 이미 status=... 를 넣고 있다. */
function readStatus(detail: Record<string, string>): FlowStepStatus {
  const raw = String(detail.status ?? '').trim().toLowerCase()
  if (raw === 'fail' || raw === 'error' || raw === 'rejected') return 'fail'
  if (raw === 'skip' || raw === 'skipped') return 'skip'
  if (raw === 'fallback' || raw === 'fallback-used') return 'fallback'
  return 'ok'
}

/** trace() 가 호출될 때마다 같은 내용을 구조체에 쌓는다. */
export function recordFlowStep(reqId: unknown, stage: string, detail: Record<string, string>): void {
  const flow = ensureFlow(normalizeReqId(reqId))

  flow.steps.push({
    seq: flow.steps.length + 1,
    stage: String(stage ?? '').trim() || '-',
    status: readStatus(detail),
    elapsedMs: Date.now() - flow.startedAtMs,
    detail,
  })

  if (flow.steps.length > STEP_LIMIT) flow.steps.splice(0, flow.steps.length - STEP_LIMIT)

  const route = String(detail.route ?? '').trim()
  if (route && !flow.route) flow.route = route
  const message = String(detail.message ?? '').trim()
  if (message && !flow.message) flow.message = message
}

/** 판단 결과를 채워 넣는다. 같은 키를 다시 쓰면 마지막 값이 남는다(= 최종 결정). */
export function markFlowDecision(reqId: unknown, decisions: FlowDecisions): void {
  const flow = ensureFlow(normalizeReqId(reqId))

  for (const [key, value] of Object.entries(decisions)) {
    if (value === undefined) continue
    ;(flow.decisions as Record<string, unknown>)[key] = value
  }
}

/** 응답/로그에 실을 최종 스냅샷. */
export function readFlowTrace(reqId: unknown): ChatFlowTrace | undefined {
  const key = normalizeReqId(reqId)
  const flow = flows.get(key)
  if (!flow) return undefined

  return {
    reqId: flow.reqId,
    route: flow.route,
    message: flow.message,
    startedAt: flow.startedAt,
    totalMs: Date.now() - flow.startedAtMs,
    decisions: { ...flow.decisions },
    steps: flow.steps.map((step) => ({ ...step, detail: { ...step.detail } })),
  }
}

/** 같은 reqId 로 다시 요청이 들어오는 경우를 위해 요청 시작 시 비운다. */
export function resetFlowTrace(reqId: unknown, seed?: { route?: string; message?: string }): void {
  const key = normalizeReqId(reqId)
  flows.delete(key)

  const flow = ensureFlow(key)
  if (seed?.route) flow.route = seed.route
  if (seed?.message) flow.message = seed.message
}
