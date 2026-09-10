import type { Connection } from '@xyflow/react'
import type { RFEdge, RFNode } from '@/store/taskflow.canvas.store'

export type ConnectDenyReason =
  | 'invalid'
  | 'target-not-left'
  | 'control-bottom'
  | 'left-not-control'
  | 'action-right-out-only'
  | 'action-single-in'
  | 'action-single-out'
  | 'control-single-right-out'
  | 'control-single-left-in'
  | 'parallel-duplicate-task'
  | 'ifthenelse-left-branch-limit'

function isSameEdgeCandidate(edge: RFEdge, c: Connection): boolean {
  return (
    String(edge.source) === String(c.source) &&
    String(edge.target) === String(c.target) &&
    String(edge.sourceHandle ?? '') === String(c.sourceHandle ?? '') &&
    String(edge.targetHandle ?? '') === String(c.targetHandle ?? '')
  )
}

export function getNodeTaskType(node: RFNode | undefined | null): string | undefined {
  return String(node?.data?.taskType ?? '').toUpperCase() || undefined
}

export function getNodeTaskName(node: RFNode | undefined | null): string | undefined {
  const raw = String(node?.data?.taskName ?? '').trim()
  return raw || undefined
}

function normalizeTaskName(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function getConnectDenyReason(
  nodes: RFNode[],
  edges: RFEdge[],
  c: Connection,
  ignoreEdgeId?: string | null
): ConnectDenyReason | null {
  if (!c.sourceHandle || !c.targetHandle) return 'invalid'

  const sourceNode = nodes.find((n) => String(n.id) === String(c.source))
  const targetNode = nodes.find((n) => String(n.id) === String(c.target))

  if (!sourceNode || !targetNode) return 'invalid'

  const sourceTaskType = getNodeTaskType(sourceNode)
  const targetTaskType = getNodeTaskType(targetNode)
  const sourceTaskName = getNodeTaskName(sourceNode)

  if (c.targetHandle !== 'left') {
    console.warn(`[CONNECT] 노드는 입력(left) 핸들로만 진입할 수 있습니다. targetHandle=${String(c.targetHandle)}`)
    return 'target-not-left'
  }

  if (c.sourceHandle !== 'right' && c.sourceHandle !== 'left') {
    console.warn(`[CONNECT] 출력은 right/left 핸들만 허용합니다. sourceHandle=${String(c.sourceHandle)}`)
    return 'invalid'
  }

  const hasExistingSameConnection = (edge: RFEdge) =>
    String(edge.id) === String(ignoreEdgeId) || isSameEdgeCandidate(edge, c)

  const sourceIsIfThenElseChild = (() => {
    const incomingLeft = edges.find(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.target) === String(c.source) &&
        String(edge.targetHandle ?? '') === 'left' &&
        String(edge.sourceHandle ?? '') === 'left'
    )
    if (!incomingLeft) return false

    const parentNode = nodes.find((node) => String(node.id) === String(incomingLeft.source))
    return normalizeTaskName(parentNode?.data?.taskName ?? parentNode?.data?.label) === 'ifthenelse'
  })()

  if (sourceTaskType === 'ACTION') {
    if (c.sourceHandle !== 'right') {
      console.warn(`[CONNECT] ACTION 노드는 오른쪽으로만 나갈 수 있습니다. sourceHandle=${String(c.sourceHandle)}`)
      return 'action-right-out-only'
    }

    const incoming = edges.filter(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.target) === String(c.target) &&
        String(edge.targetHandle) === 'left'
    )
    if (incoming.length > 0) {
      console.warn(`[CONNECT] ACTION 노드는 왼쪽 입력이 1개를 초과할 수 없습니다. target=${String(c.target)}`)
      return 'action-single-in'
    }

    const outgoing = edges.filter(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.source) === String(c.source) &&
        String(edge.sourceHandle) === 'right'
    )
    if (outgoing.length > 0 && !sourceIsIfThenElseChild) {
      console.warn(`[CONNECT] ACTION 노드는 오른쪽 출력이 1개를 초과할 수 없습니다. source=${String(c.source)}`)
      return 'action-single-out'
    }
  }

  if (targetTaskType === 'CONTROL' && c.targetHandle === 'left') {
    const incomingLeft = edges.filter(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.target) === String(c.target) &&
        String(edge.targetHandle) === 'left'
    )
    if (incomingLeft.length > 0) {
      console.warn(`[CONNECT] CONTROL 노드의 왼쪽 입력은 1개만 허용합니다. target=${String(c.target)}`)
      return 'control-single-left-in'
    }
  }

  if (sourceTaskType === 'CONTROL' && c.sourceHandle === 'right') {
    const outgoingRight = edges.filter(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.source) === String(c.source) &&
        String(edge.sourceHandle) === 'right'
    )
    if (outgoingRight.length > 0) {
      console.warn(`[CONNECT] CONTROL 노드의 오른쪽 출력은 1개만 허용합니다. source=${String(c.source)}`)
      return 'control-single-right-out'
    }
  }

  // Parallel 은 자식을 동시에 실행한다. 같은 Task 를 둘 이상 두면(얼굴 2개, 발화 2개) 동시에 수행할 수 없다.
  const parallelNodeId = normalizeTaskName(sourceTaskName) === 'parallel' ? String(c.source) : null
  if (parallelNodeId && c.sourceHandle === 'left' && targetTaskType === 'ACTION') {
    const targetKey = normalizeTaskName(getNodeTaskName(targetNode))
    const existingChildren = edges.filter(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.source) === parallelNodeId &&
        String(edge.sourceHandle) === 'left'
    )

    const duplicateSameTask = existingChildren.some((edge) => {
      const childNode = nodes.find((n) => String(n.id) === String(edge.target))
      return getNodeTaskType(childNode) === 'ACTION' && normalizeTaskName(getNodeTaskName(childNode)) === targetKey
    })

    if (duplicateSameTask) {
      console.warn(
        `[CONNECT] Parallel 노드는 같은 Task 의 자식을 2개 이상 둘 수 없습니다. parallel=${parallelNodeId} task=${String(getNodeTaskName(targetNode))}`
      )
      return 'parallel-duplicate-task'
    }
  }

  const ifThenElseNodeId = normalizeTaskName(sourceTaskName) === 'ifthenelse' ? String(c.source) : null
  if (ifThenElseNodeId && c.sourceHandle === 'left') {
    const existingLeftChildren = edges.filter(
      (edge) =>
        !hasExistingSameConnection(edge) &&
        String(edge.source) === ifThenElseNodeId &&
        String(edge.sourceHandle) === 'left'
    )

    if (existingLeftChildren.length >= 3) {
      console.warn(
        `[CONNECT] IfThenElse는 좌측 자식을 3개까지만 가질 수 있습니다. source=${ifThenElseNodeId} count=${existingLeftChildren.length + 1}`
      )
      return 'ifthenelse-left-branch-limit'
    }
  }

  return null
}
