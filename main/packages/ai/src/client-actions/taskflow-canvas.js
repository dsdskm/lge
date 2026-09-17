import {
  AI_TASKFLOW_CANVAS_CLARIFY_EVENT,
  AI_TASKFLOW_CANVAS_DRAFT_EVENT,
  AI_TASKFLOW_CANVAS_RESULT_EVENT,
  TASKFLOW_CANVAS_RULE_ROUTE_KEY
} from '@repo/constants'

const CANVAS_ROUTE_PATTERN = /^\/?tms\/taskflows\/[^/?#]+\/canvas\/?(?:[?#].*)?$/
const APPLY_TIMEOUT_MS = 15000

function isCanvasScreen(screenKey) {
  const route = String(screenKey ?? '').trim()
  return route === TASKFLOW_CANVAS_RULE_ROUTE_KEY || CANVAS_ROUTE_PATTERN.test(route)
}

/** draft 를 캔버스에 넘기고 실제 반영 결과를 기다린다.
 * 캔버스가 노드/엣지를 만든 뒤 결과 이벤트를 보내므로, 반영 전에 성공 문구를 내보내지 않게 한다.
 * @returns {Promise<{ applied: boolean, message: string }>}
 */
export function applyTaskflowDraft({ args, screenKey, message, signal } = {}) {
  const draft = args?.draft
  if (!draft || typeof draft !== 'object') {
    console.warn('[ai-trace] 8.canvas-apply 건너뜀 reason=draft 없음', { args })
    return Promise.resolve({ applied: false, message: '', notices: [] })
  }
  if (typeof window === 'undefined' || !isCanvasScreen(screenKey)) {
    console.warn('[ai-trace] 8.canvas-apply 건너뜀 reason=캔버스 화면이 아님', { screenKey })
    return Promise.resolve({ applied: false, message: '', notices: [] })
  }

  const assistantMessageId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return new Promise((resolve) => {
    const cleanup = () => {
      window.removeEventListener(AI_TASKFLOW_CANVAS_CLARIFY_EVENT, handleClarification)
      window.removeEventListener(AI_TASKFLOW_CANVAS_RESULT_EVENT, handleResult)
      signal?.removeEventListener('abort', handleAbort)
      clearTimeout(timeoutId)
    }

    // notices: 캔버스가 알려 준 부가 사실(요청과 다른 이름으로 대체된 노드 등). 응답 문구에 덧붙는다.
    const finish = (applied, resultMessage, notices = []) => {
      cleanup()
      resolve({
        applied,
        message: String(resultMessage ?? '').trim(),
        notices: Array.isArray(notices) ? notices.filter(Boolean).map((item) => String(item)) : []
      })
    }

    const handleClarification = (event) => {
      const detail = event.detail
      if (String(detail?.assistantMessageId ?? '') !== assistantMessageId) return
      console.log('[ai-trace] 8.canvas-apply clarification', { message: detail?.message })
      finish(false, detail?.message)
    }

    const handleResult = (event) => {
      const detail = event.detail
      if (detail?.kind !== 'draft') return
      if (String(detail?.assistantMessageId ?? '') !== assistantMessageId) return
      console.log('[ai-trace] 8.canvas-apply result', {
        didApply: detail?.didApply ?? detail?.success,
        insertedNodeCount: detail?.insertedNodeCount,
        message: detail?.message
      })
      finish(Boolean(detail?.didApply ?? detail?.success), detail?.message, detail?.substitutions)
    }

    const handleAbort = () => finish(false, '')

    const timeoutId = window.setTimeout(() => {
      // 캔버스 페이지가 이벤트를 못 받았거나 팔레트 로딩이 끝나지 않은 경우.
      console.warn('[ai-trace] 8.canvas-apply 타임아웃', { assistantMessageId, timeoutMs: APPLY_TIMEOUT_MS })
      finish(false, '')
    }, APPLY_TIMEOUT_MS)

    window.addEventListener(AI_TASKFLOW_CANVAS_CLARIFY_EVENT, handleClarification)
    window.addEventListener(AI_TASKFLOW_CANVAS_RESULT_EVENT, handleResult)
    signal?.addEventListener('abort', handleAbort, { once: true })

    console.log('[ai-trace] 8.canvas-apply dispatch', { assistantMessageId, mode: draft.mode })
    window.dispatchEvent(
      new CustomEvent(AI_TASKFLOW_CANVAS_DRAFT_EVENT, {
        detail: {
          ...draft,
          message: String(message ?? ''),
          assistantMessageId
        }
      })
    )
  })
}
