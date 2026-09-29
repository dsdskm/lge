import { isAlwaysSuccessRuleMatch } from '../bt.util'
import type { BtRule } from './types'
import { createBtActionNode } from '../mapping/createBtActionNode'
import { alwaysSuccessNodeName } from '../nodes/btAlwaysSuccessNode'

export const rule_alwaysSuccess: BtRule<typeof alwaysSuccessNodeName> = {
  name: alwaysSuccessNodeName,

  match: ({ node, outgoing }) => {
    return isAlwaysSuccessRuleMatch(node, outgoing)
  },

  apply: ({ node, outgoing, nodeById, buildAstList }) => {
    const candidateTargetRefs = outgoing?.leftBranches ?? []
    const bottomRef = outgoing?.bottom
    const nextTargetRef = outgoing?.right

    if (nextTargetRef) {
      throw new Error(`AlwaysSuccess 노드는 다음 노드가 없어야 합니다. (node_id=${String(node.id)})`)
    }

    if (candidateTargetRefs.length > 0) {
      throw new Error(`AlwaysSuccess 노드는 하위 노드가 없어야 합니다. (node_id=${String(node.id)})`)
    }
    if (bottomRef) {
      throw new Error(`AlwaysSuccess 노드는 하위 노드가 없어야 합니다. (node_id=${String(node.id)})`)
    }

    const conditionAction = createBtActionNode(node)

    return [conditionAction]
  }
}
