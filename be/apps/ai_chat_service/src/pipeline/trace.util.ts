/** 자연어 -> 도구 -> 캔버스 반영 흐름을 한 줄씩 따라갈 수 있게 하는 추적 로그.
 * 기존 orchestrator 로거는 의도적으로 침묵(logger.log = noop)이라 여기서는 console 을 직접 쓴다.
 * 프론트도 같은 접두어([ai-trace])를 쓰므로 reqId 로 서버/브라우저 로그를 이어 볼 수 있다.
 * 끄고 싶으면 AI_TRACE=off.
 */
import { recordFlowStep } from './flow-trace'

const TRACE_PREFIX = '[ai-trace]'
const ENABLED = String(process.env.AI_TRACE ?? '').trim().toLowerCase() !== 'off'

function preview(value: unknown, limit = 600): string {
  if (value === undefined) return '-'
  if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…` : value

  try {
    const text = JSON.stringify(value)
    return text.length > limit ? `${text.slice(0, limit)}…` : text
  } catch {
    return String(value)
  }
}

/** 최근 추적 기록. 서버 콘솔을 볼 수 없는 곳에서도 GET /chat/settings/trace 로 확인한다. */
export type TraceEntry = {
  at: string
  reqId: string
  stage: string
  detail: Record<string, string>
}

const TRACE_BUFFER_LIMIT = 500
const traceBuffer: TraceEntry[] = []

export function trace(reqId: string | undefined, stage: string, detail?: Record<string, unknown>): void {
  const normalizedReqId = String(reqId ?? '-') || '-'
  const entries = Object.entries(detail ?? {}).map(([key, value]) => [key, preview(value)] as const)

  // 콘솔 출력은 끌 수 있어도, 채팅 내역에 남기는 흐름 기록은 항상 모은다.
  recordFlowStep(normalizedReqId, stage, Object.fromEntries(entries))

  if (!ENABLED) return

  console.log(
    `${TRACE_PREFIX} reqId=${normalizedReqId} ${stage}${entries.length > 0 ? ` ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}`,
  )

  traceBuffer.push({
    at: new Date().toISOString(),
    reqId: normalizedReqId,
    stage,
    detail: Object.fromEntries(entries),
  })
  if (traceBuffer.length > TRACE_BUFFER_LIMIT) traceBuffer.splice(0, traceBuffer.length - TRACE_BUFFER_LIMIT)
}

/** 최근 추적 기록 조회. reqId 를 주면 그 요청만 시간순으로 돌려준다. */
export function readTrace(reqId?: string, limit = 100): TraceEntry[] {
  const key = String(reqId ?? '').trim()
  const rows = key ? traceBuffer.filter((entry) => entry.reqId === key) : traceBuffer

  return rows.slice(-Math.max(1, limit))
}

/** ToolContext 에 실려 온 reqId. 도구 안에서 추적 로그를 남길 때 쓴다. */
export function traceReqId(context: unknown): string {
  if (!context || typeof context !== 'object') return '-'
  return String((context as Record<string, unknown>).__reqId ?? '-') || '-'
}

export { preview as tracePreview }
