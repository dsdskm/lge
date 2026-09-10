import { resolveActionTools } from './screen-registry'
import { TASKFLOW_TOOL_KEY } from './tools/taskflow-message'

const factories = {
  [TASKFLOW_TOOL_KEY.compose]: () => ({
    declaration: { name: 'compose_linear_taskflow', description: 'c' },
    execute: async () => ({}),
  }),
  [TASKFLOW_TOOL_KEY.edit]: () => ({
    declaration: { name: 'edit_taskflow', description: 'e' },
    execute: async () => ({}),
  }),
  [TASKFLOW_TOOL_KEY.readGraph]: () => ({
    declaration: { name: 'read_taskflow_graph', description: 'r' },
    execute: async () => ({}),
  }),
} as any

describe('resolveActionTools', () => {
  it('registers only the tools registered for the screen', () => {
    const { tools } = resolveActionTools([TASKFLOW_TOOL_KEY.compose], factories)
    expect(tools.map((tool) => tool.declaration.name)).toEqual(['compose_linear_taskflow'])
  })

  it('registers edit and read independently so one missing row does not drop the other', () => {
    const { tools } = resolveActionTools([TASKFLOW_TOOL_KEY.edit], factories)
    expect(tools.map((tool) => tool.declaration.name)).toEqual(['edit_taskflow'])
  })

  it('keeps the order registered in the table', () => {
    const { tools } = resolveActionTools(
      [TASKFLOW_TOOL_KEY.readGraph, TASKFLOW_TOOL_KEY.compose, TASKFLOW_TOOL_KEY.edit],
      factories,
    )
    expect(tools.map((tool) => tool.declaration.name)).toEqual([
      'read_taskflow_graph',
      'compose_linear_taskflow',
      'edit_taskflow',
    ])
  })

  it('reports tool keys that have no implementation', () => {
    const { tools, unknown } = resolveActionTools(['tool.typo'], factories)

    expect(tools).toEqual([])
    expect(unknown).toEqual(['tool.typo'])
  })

  it('registers nothing when the screen has no rows so it falls back to action RAG', () => {
    expect(resolveActionTools([], factories).tools).toEqual([])
  })

  it('reports tools whose factory refused to build', () => {
    const refusing = { [TASKFLOW_TOOL_KEY.compose]: () => null } as any
    const { tools, skipped } = resolveActionTools([TASKFLOW_TOOL_KEY.compose], refusing)

    expect(tools).toEqual([])
    expect(skipped).toEqual([TASKFLOW_TOOL_KEY.compose])
  })
})
