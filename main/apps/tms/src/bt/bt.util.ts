import type { Node } from '@xyflow/react'
import type { BtAstNode } from './types'
import { sequenceNodeType, BtSequenceNode } from './nodes/btSequenceNode'
import type { OutgoingEdgeRef, OutgoingInfo } from './rules/types'
import { sanitizeXmlAttrValue } from './render/xml'

export function getNodeTaskType(node: Node): string {
  const data: any = (node as any).data ?? {}
  return String(data.taskType ?? '').toUpperCase()
}

export function getNodeTaskName(node: Node): string {
  const data: any = (node as any).data ?? {}
  return String(data.taskName ?? data.label ?? data.name ?? '')
    .trim()
    .toLowerCase()
}

export function getNodeDisplayName(node: Node | undefined | null): string {
  if (!node) return '(unknown)'

  const data: any = (node as any).data ?? {}
  const name = data.taskName ?? data.label ?? data.name ?? data.title ?? node.id

  return `${String(name)} [id=${String(node.id)}]`
}

export function getRuleNodeName(node: Node, prefix: string): string {
  const data: any = (node as any).data ?? {}
  const rawName = String(data.taskName ?? data.label ?? data.name ?? node.id)
  return `${prefix}_${sanitizeXmlAttrValue(rawName)}`
}

export function isActionNode(node: Node): boolean {
  return getNodeTaskType(node) === 'ACTION'
}

export function isControlNode(node: Node): boolean {
  return getNodeTaskType(node) === 'CONTROL'
}

export function isFallbackControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'fallback'
}

export function isSequenceControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'sequence'
}

export function isReactiveFallbackControlNode(node: Node): boolean {
  if (!isControlNode(node)) return false

  const name = getNodeTaskName(node)
  return name === 'reactivefallback'
}

export function isReactiveSequenceControlNode(node: Node): boolean {
  if (!isControlNode(node)) return false

  const name = getNodeTaskName(node)
  return name === 'reactivesequence'
}

export function isParallelControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'parallel'
}

export function isRepeatControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'repeat'
}

export function isIfThenElseControlNode(node: Node): boolean {
  if (!isControlNode(node)) return false

  const name = getNodeTaskName(node)
  return name === 'if then else' || name === 'ifthenelse' || name === 'if_then_else'
}

export function isForceSuccessControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'forcesuccess'
}

export function isForceFailureControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'forcefailure'
}

export function isRetryUntilSuccessfulControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'retryuntilsuccessful'
}

export function isPreconditionControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'precondition'
}

export function isDelayControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'delay'
}

export function isTimeoutControlNode(node: Node): boolean {
  return isControlNode(node) && getNodeTaskName(node) === 'timeout'
}

export function isAlwaysSuccessNode(node: Node): boolean {
  return isActionNode(node) && getNodeTaskName(node) === 'alwayssuccess'
}

export function canUseLeftBranches(node: Node): boolean {
  return (
    isFallbackControlNode(node) ||
    isSequenceControlNode(node) ||
    isReactiveFallbackControlNode(node) ||
    isReactiveSequenceControlNode(node) ||
    isParallelControlNode(node) ||
    isRepeatControlNode(node) ||
    isIfThenElseControlNode(node) ||
    isForceSuccessControlNode(node) ||
    isForceFailureControlNode(node) ||
    isRetryUntilSuccessfulControlNode(node) ||
    isPreconditionControlNode(node) ||
    isDelayControlNode(node) ||
    isTimeoutControlNode(node)
  )
}

export function hasLeftBranches(outgoing?: OutgoingInfo): boolean {
  return (outgoing?.leftBranches?.length ?? 0) > 0
}

export function hasRightOutgoing(outgoing?: OutgoingInfo): boolean {
  return !!outgoing?.right
}

export function hasBottomOutgoing(outgoing?: OutgoingInfo): boolean {
  return !!outgoing?.bottom
}

export function hasOnlyRightOutgoing(outgoing?: OutgoingInfo): boolean {
  return hasRightOutgoing(outgoing) && !hasBottomOutgoing(outgoing) && !hasLeftBranches(outgoing)
}

export function hasOnlyLeftBranches(outgoing?: OutgoingInfo): boolean {
  return hasLeftBranches(outgoing) && !hasBottomOutgoing(outgoing) && !hasRightOutgoing(outgoing)
}

export function isFallbackRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isFallbackControlNode(node) && hasLeftBranches(outgoing)
}

// Sequence 는 컨트롤 노드이므로 leftBranch 유무와 무관하게 항상 Sequence 규칙이 매칭돼야 한다.
// (leftBranch 조건을 걸면 자식 없이 right 만 연결된 Sequence 가 ifThen 규칙으로 넘어가 Action 으로 생성됨)
export function isSequenceRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isSequenceControlNode(node)
}

export function isReactiveFallbackRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isReactiveFallbackControlNode(node) && hasLeftBranches(outgoing)
}

export function isReactiveSequenceRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isReactiveSequenceControlNode(node) && hasLeftBranches(outgoing)
}

export function isParallelRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isParallelControlNode(node)
}

export function isRepeatRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isRepeatControlNode(node)
}

export function isForceSuccessRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isForceSuccessControlNode(node)
}

export function isForceFailureRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isForceFailureControlNode(node)
}

export function isRetryUntilSuccessfulRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isRetryUntilSuccessfulControlNode(node)
}

export function isPreconditionRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isPreconditionControlNode(node)
}

export function isDelayRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isDelayControlNode(node)
}

export function isTimeoutRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isTimeoutControlNode(node)
}

export function isIfThenElseRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isIfThenElseControlNode(node) && hasLeftBranches(outgoing)
}

export function isIfThenRuleMatch(outgoing?: OutgoingInfo): boolean {
  return hasOnlyRightOutgoing(outgoing)
}

export function isAlwaysSuccessRuleMatch(node: Node, outgoing?: OutgoingInfo): boolean {
  return isAlwaysSuccessNode(node)
}

export function sortNodeIdsByCanvasPosition(nodeIds: string[], nodeById: Map<string, Node>): string[] {
  return [...nodeIds].sort((a, b) => {
    const na = nodeById.get(a)
    const nb = nodeById.get(b)

    const ay = na?.position?.y ?? 0
    const by = nb?.position?.y ?? 0
    if (ay !== by) return ay - by

    const ax = na?.position?.x ?? 0
    const bx = nb?.position?.x ?? 0
    if (ax !== bx) return ax - bx

    return String(a).localeCompare(String(b))
  })
}

export function sortOutgoingEdgeRefsByCanvasPosition(
  refs: OutgoingEdgeRef[],
  nodeById: Map<string, Node>
): OutgoingEdgeRef[] {
  return [...refs].sort((a, b) => {
    const na = nodeById.get(a.targetId)
    const nb = nodeById.get(b.targetId)

    const ay = na?.position?.y ?? 0
    const by = nb?.position?.y ?? 0
    if (ay !== by) return ay - by

    const ax = na?.position?.x ?? 0
    const bx = nb?.position?.x ?? 0
    if (ax !== bx) return ax - bx

    return String(a.targetId).localeCompare(String(b.targetId))
  })
}

export function wrapAstListAsSequenceIfNeeded(astList: BtAstNode[], sequenceName: string): BtAstNode {
  if (astList.length === 0) {
    return {
      kind: sequenceNodeType,
      name: sequenceName,
      children: []
    } satisfies BtSequenceNode
  }

  if (astList.length === 1) {
    return astList[0]
  }

  return {
    kind: sequenceNodeType,
    name: sequenceName,
    children: astList
  } satisfies BtSequenceNode
}

export function getNodePropertyValue(node: any, key: string): unknown {
  const properties = node?.data?.properties ?? {}

  if (properties[key] !== undefined) return properties[key]

  return undefined
}

export function getNodeNumberPropertyValue(node: any, fallback: number, key: string): number {
  const value = getNodePropertyValue(node, key)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
