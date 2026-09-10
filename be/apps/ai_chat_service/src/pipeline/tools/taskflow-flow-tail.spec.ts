import { findFlowTailNode } from './taskflow-palette'
import type { CurrentGraph } from './taskflow-palette'

const node = (id: string, label: string, taskType: string, taskName = label) => ({
  id,
  label,
  taskName,
  taskType,
  contentName: undefined,
  ordinal: undefined,
})

const graph = (nodes: any[], edges: Array<[string, string, boolean?]>): CurrentGraph => ({
  nodes,
  edges: edges.map(([source, target, branch]) => ({ source, target, branch: Boolean(branch) })),
})

describe('findFlowTailNode', () => {
  it('Start 에서 이어지는 흐름의 마지막 노드를 고른다', () => {
    const current = graph(
      [node('start', 'Start', 'ROOT'), node('n1', 'Pause', 'ACTION'), node('n2', 'Love', 'ACTION')],
      [
        ['start', 'n1'],
        ['n1', 'n2'],
      ],
    )

    expect(findFlowTailNode(current)?.label).toBe('Love')
  })

  it('제어 노드의 자식(branch)은 따라가지 않아 흐름의 끝은 제어 노드다', () => {
    const current = graph(
      [
        node('start', 'Start', 'ROOT'),
        node('n1', 'Pause', 'ACTION'),
        node('n2', 'Parallel', 'CONTROL'),
        node('n3', 'Love', 'ACTION'),
        node('n4', 'Idle', 'ACTION'),
      ],
      [
        ['start', 'n1'],
        ['n1', 'n2'],
        ['n2', 'n3', true],
        ['n2', 'n4', true],
      ],
    )

    expect(findFlowTailNode(current)?.label).toBe('Parallel')
  })

  it('Start 만 있으면 기준 노드가 없다', () => {
    expect(findFlowTailNode(graph([node('start', 'Start', 'ROOT')], []))).toBeUndefined()
  })

  it('빈 캔버스면 기준 노드가 없다', () => {
    expect(findFlowTailNode(graph([], []))).toBeUndefined()
  })

  it('흐름과 떨어져 있는 노드는 끝으로 보지 않는다', () => {
    const current = graph(
      [
        node('start', 'Start', 'ROOT'),
        node('n1', 'Pause', 'ACTION'),
        node('n9', 'Joy', 'ACTION'),
      ],
      [['start', 'n1']],
    )

    expect(findFlowTailNode(current)?.label).toBe('Pause')
  })
})
