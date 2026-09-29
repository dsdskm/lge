import type { BtAstNode } from '../types'
import {
  isParallelRuleMatch,
  sortNodeIdsByCanvasPosition,
  getNodeNumberPropertyValue,
  getNodePropertyValue,
  wrapAstListAsSequenceIfNeeded,
  getRuleNodeName
} from '../bt.util'
import type { BtRule } from './types'
import {
  BtParallelNode,
  parallelFailureCountProp,
  parallelMainNodesProp,
  parallelNodeName,
  parallelNodeType,
  parallelSuccessCountProp
} from '../nodes/btParallelNode'
import { forceSuccessNodeType } from '../nodes/btForceSuccessNode'
import { actionNodeType, alwaysRunningActionName, alwaysRunningActionTag } from '../nodes/btActionNode'
import { sequenceNodeType, type BtSequenceNode } from '../nodes/btSequenceNode'

export const rule_parallel: BtRule<typeof parallelNodeName> = {
  name: parallelNodeName,

  match: ({ node, outgoing }) => {
    return isParallelRuleMatch(node, outgoing)
  },

  apply: ({ node, outgoing, nodeById, buildAstList }) => {
    const leftBranchEntries = normalizeLeftBranchEntries(outgoing?.leftBranches)
    const nextEntry = normalizeSingleBranchEntry(outgoing?.right)

    const orderedBranchEntries = sortBranchEntriesByCanvasPosition(leftBranchEntries, nodeById)

    const childCount = orderedBranchEntries.length

    // main_nodes 에 포함된 자식만 success/failure 판정에 사용한다.
    // main_nodes 가 비어 있으면(미설정) 모든 자식을 main 으로 간주(기존 동작 유지).
    const mainTargetSet = resolveMainTargetSet(node, orderedBranchEntries)
    const mainCount = mainTargetSet ? mainTargetSet.size : childCount

    const branchChildren: BtAstNode[] = orderedBranchEntries.map((entry, idx) => {
      const astList = buildAstList(entry.targetId)
      const isMain = !mainTargetSet || mainTargetSet.has(entry.targetId)

      if (isMain) {
        return wrapAstListAsSequenceIfNeeded(astList, `parallel_branch_${idx + 1}`)
      }

      // main 이 아닌 분기는 <Sequence><ForceSuccess>...</ForceSuccess><Action ID="AlwaysRunning"/></Sequence> 로 감싼다.
      // ForceSuccess 로 실패를 흡수하고, 뒤따르는 AlwaysRunning 이 분기를 RUNNING 으로 유지해
      // success_count 판정에서 제외되도록 한다.
      const child = wrapAstListAsSequenceIfNeeded(astList, `parallel_branch_${idx + 1}_body`)

      return {
        kind: sequenceNodeType,
        name: `parallel_branch_${idx + 1}`,
        children: [
          { kind: forceSuccessNodeType, child },
          {
            kind: actionNodeType,
            tag: alwaysRunningActionTag,
            name: alwaysRunningActionName,
            attrs: {}
          }
        ]
      } satisfies BtSequenceNode
    })

    const successCount = resolveSuccessCount(node, mainCount)
    const failureCount = resolveFailureCount(node, mainCount)

    const parallelNode: BtParallelNode = {
      kind: parallelNodeType,
      name: getRuleNodeName(node, 'parallel'),
      successCount,
      failureCount,
      attrs: {
        node_id: String(node.id)
      },
      children: branchChildren
    }

    if (!nextEntry) {
      return [parallelNode]
    }

    return [parallelNode, ...buildAstList(nextEntry.targetId)]
  }
}

type BranchEntry = {
  targetId: string
}

function normalizeLeftBranchEntries(value: any): BranchEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => normalizeSingleBranchEntry(item)).filter((item): item is BranchEntry => !!item)
}

function normalizeSingleBranchEntry(value: any): BranchEntry | null {
  if (!value) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return {
      targetId: String(value)
    }
  }

  if (typeof value === 'object') {
    const targetId = value.targetId ?? value.target ?? value.nodeId ?? value.node_id

    if (targetId == null || targetId === '') {
      return null
    }

    return {
      targetId: String(targetId)
    }
  }

  return null
}

// node.properties.main_nodes(문자열 배열)와 실제 좌측 자식 교집합을 Set 으로 반환한다.
// 미설정(배열 아님)이면 null(=전체 main)을 반환한다.
// 배열이면 명시 선택으로 보고 교집합 Set 을 반환한다(빈 배열=0개 선택 → 빈 Set).
function resolveMainTargetSet(node: any, entries: BranchEntry[]): Set<string> | null {
  const raw = getNodePropertyValue(node, parallelMainNodesProp)

  if (!Array.isArray(raw)) {
    return null
  }

  const validTargetIds = new Set(entries.map((entry) => entry.targetId))
  const mainSet = new Set<string>()
  for (const id of raw) {
    const key = String(id)
    if (validTargetIds.has(key)) mainSet.add(key)
  }

  return mainSet
}

function sortBranchEntriesByCanvasPosition(entries: BranchEntry[], nodeById: Map<string, any>): BranchEntry[] {
  if (entries.length <= 1) {
    return entries
  }

  const orderedIds = sortNodeIdsByCanvasPosition(
    entries.map((entry) => entry.targetId),
    nodeById
  )

  const entryByTargetId = new Map<string, BranchEntry>()
  for (const entry of entries) {
    entryByTargetId.set(entry.targetId, entry)
  }

  return orderedIds.map((targetId) => entryByTargetId.get(targetId)).filter((entry): entry is BranchEntry => !!entry)
}

function resolveSuccessCount(node: any, childCount: number): number {
  const value = getNodeNumberPropertyValue(node, -1, parallelSuccessCountProp)

  return validateParallelThreshold(value, childCount, parallelSuccessCountProp, node)
}

function resolveFailureCount(node: any, childCount: number): number {
  const value = getNodeNumberPropertyValue(node, -1, parallelFailureCountProp)

  return validateParallelThreshold(value, childCount, parallelFailureCountProp, node)
}

function validateParallelThreshold(
  value: number,
  childCount: number,
  fieldName: typeof parallelSuccessCountProp | typeof parallelFailureCountProp,
  node: any
): number {
  if (childCount <= 0) {
    throw new Error(`Parallel 노드에 main 노드가 없습니다. (node_id=${String(node?.id ?? '')})`)
  }

  if (value === -1) {
    return value
  }

  if (!Number.isFinite(value)) {
    throw new Error(
      `Parallel 노드의 ${fieldName} 값이 올바르지 않습니다. (node_id=${String(node?.id ?? '')}, 값=${String(value)})`
    )
  }

  if (value < 1) {
    throw new Error(
      `Parallel 노드의 ${fieldName} 값은 1 이상이거나 -1 이어야 합니다. (node_id=${String(node?.id ?? '')}, 값=${String(value)})`
    )
  }

  if (value > childCount) {
    throw new Error(
      `Parallel 노드의 ${fieldName} 값은 main 노드 수(${childCount})를 초과할 수 없습니다. (node_id=${String(node?.id ?? '')}, 값=${String(value)})`
    )
  }

  return value
}
