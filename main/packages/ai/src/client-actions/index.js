import { CLIENT_ACTION } from '@repo/constants'
import { applyTaskflowDraft } from './taskflow-canvas.js'

/** 서버가 이름으로 지시할 수 있는 프론트 함수. 여기 없는 이름은 실행하지 않는다.
 * 이름은 LLM 함수와 짝이다. compose/edit 는 결과가 같은 draft 라 같은 핸들러를 쓴다.
 * read_taskflow_graph 는 캔버스를 바꾸지 않으므로 프론트 함수가 없다.
 */
const CLIENT_ACTION_HANDLERS = {
  [CLIENT_ACTION.COMPOSE_LINEAR_TASKFLOW]: applyTaskflowDraft,
  [CLIENT_ACTION.EDIT_TASKFLOW]: applyTaskflowDraft
}

/** 응답에서 clientAction 을 찾는다. 도구 결과가 한 겹 더 감싸여 오는 경우까지 본다.
 * 구버전 서버가 내려주던 canvasDraft 도 같은 형태로 정규화한다.
 */
export function findClientAction(payload) {
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 4) return null

    if (value.clientAction && typeof value.clientAction === 'object') {
      const name = String(value.clientAction.name ?? '').trim()
      if (name) return { name, args: value.clientAction.args ?? {} }
    }

    // 구버전 서버 응답. 어느 도구가 만든 draft 인지 구분이 없어 compose 핸들러로 보낸다(동작은 동일).
    if (value.canvasDraft && typeof value.canvasDraft === 'object') {
      return { name: CLIENT_ACTION.COMPOSE_LINEAR_TASKFLOW, args: { draft: value.canvasDraft } }
    }

    for (const key of ['chat_action_param', 'toolResult', 'data', 'draft']) {
      const found = visit(value[key], depth + 1)
      if (found) return found
    }

    return null
  }

  return visit(payload, 0)
}

/** 서버가 지시한 프론트 함수를 실행한다.
 * @returns {Promise<null | { applied: boolean, message: string, notices: string[] }>} 지시가 없으면 null.
 */
export async function runClientAction({ payload, screenKey, message, signal } = {}) {
  const action = findClientAction(payload)
  if (!action) {
    // 서버가 실행을 지시하지 않았다. 캔버스가 안 바뀌면 서버 로그의 6.reply 를 먼저 본다.
    console.log('[ai-trace] 7.client-action name=- reason=응답에 clientAction 없음', {
      chatAction: payload?.data?.chat_action ?? payload?.chat_action ?? '-'
    })
    return null
  }

  const draft = action.args?.draft
  console.log('[ai-trace] 7.client-action', {
    name: action.name,
    screenKey,
    mode: draft?.mode ?? '-',
    rootCount: Array.isArray(draft?.roots) ? draft.roots.length : 0,
    insertCount: Array.isArray(draft?.insertAfter) ? draft.insertAfter.length : 0,
    removeCount: Array.isArray(draft?.removeByName) ? draft.removeByName.length : 0,
    replaceCount: Array.isArray(draft?.replaceByName) ? draft.replaceByName.length : 0
  })

  const handler = CLIENT_ACTION_HANDLERS[action.name]
  if (!handler) {
    console.warn('[ai-trace] 7.client-action 등록되지 않은 함수 이름', {
      name: action.name,
      registered: Object.keys(CLIENT_ACTION_HANDLERS),
      hint: 'action_tool.client_function 값과 client-actions 레지스트리 키가 다르다'
    })
    return { applied: false, message: '', notices: [] }
  }

  const result = await handler({ args: action.args, screenKey, message, signal })
  console.log('[ai-trace] 9.client-action-result', { name: action.name, ...result })

  return result
}
