import type { ToolContext, ToolDefinition } from '../tool.type'
import { getPropertyTmsStore, TASK_TYPE, type TaskSemantics } from '../../features/taskflow/service/property-tms-store.service'
import {
  findContentRef,
  findSuggestions,
  formatNodeLabel,
  readCurrentGraph,
  describeTaskProperties,
  readTaskContents,
  resolveProperties,
  toMatchKey,
  TASKFLOW_CANVAS_SCREEN_KEY,
  type TaskContentRef,
} from './taskflow-palette'
import { taskflowMessage, taskflowMessageNumber, TASKFLOW_MESSAGE_KEY } from './taskflow-message'
import { includesConfiguredPhrase, loadTaskflowClassifierRules } from '../taskflow-language-rules'
import { trace, traceReqId } from '../trace.util'
import { buildApplyDraftAction } from './taskflow-client-action'
import { parseComposeNodesFromMessage } from './taskflow-nl-compose'
import { markFlowDecision } from '../flow-trace'

/** LLM 이 내려주는 노드. 트리는 preorder + depth 로 표현해 id/좌표 환각을 원천 차단한다. */
type ComposeNodeArg = {
  depth: number
  taskName: string
  contentName?: string
  /** Delay 의 delay_msec 처럼 값으로 지정하는 속성. 스키마에 있는 키만 반영된다. */
  properties?: Record<string, unknown>
}

export type TaskflowTreeNode = {
  taskName: string
  taskType: string
  contentName?: string
  contentId?: number
  properties?: Record<string, unknown>
  children: TaskflowTreeNode[]
}

type ComposeFailure = {
  clarification: string
  suggestions: string[]
}

/** 사용자 요청과 실제 구성이 달라진 지점. 응답에 그대로 드러낸다. */
type ComposeNotes = {
  unknownProperties: string[]
  missing: string[]
  unresolved: string[]
  substituted: Array<{ requested: string; resolved: string }>
  /** 대상을 못 찾아 같은 Task 의 다른 콘텐츠로 임시 채운 경우. */
  placeholders: Array<{ requested: string; placedWith: string }>
}

const TOOL_NAME = 'compose_linear_taskflow'

function readComposeIntents(task: TaskSemantics): string[] {
  const single = String(task.composeHint?.intent ?? '').trim()
  const many = Array.isArray(task.composeHint?.intents) ? task.composeHint.intents : []

  return [single, ...many.map((value) => String(value ?? '').trim())].filter(Boolean)
}

function findTaskNamesByIntent(tasks: TaskSemantics[], intent: string): string[] {
  return tasks.filter((task) => readComposeIntents(task).includes(intent)).map((task) => task.taskName)
}

// 제어 노드 이름을 하드코딩하지 않는다. 카탈로그에 없는 이름을 안내하면 LLM 이 그대로 쓰고 거부된다.
function buildDescription(catalogText: string, tasks: TaskSemantics[]): string {
  const joiner = taskflowMessage(TASKFLOW_MESSAGE_KEY.composeTaskJoiner)
  const buildRule = (intent: string, key: string) => {
    const names = findTaskNamesByIntent(tasks, intent)
    if (names.length === 0) return ''
    return taskflowMessage(key, { tasks: names.join(joiner) })
  }

  return taskflowMessage(TASKFLOW_MESSAGE_KEY.toolCompose, {
    catalog: catalogText,
    concurrentRule: buildRule('concurrent', TASKFLOW_MESSAGE_KEY.composeConcurrentRule),
    alternativeRule: buildRule('alternative', TASKFLOW_MESSAGE_KEY.composeAlternativeRule),
    propertyCatalog: describeTaskProperties(tasks),
  })
}

/** "Parallel > [도슨트 대기, 이동 음악, Joy]" 처럼 트리를 한 줄로 적는다. 구조가 맞는지 눈으로 보는 용도. */
function describeTree(nodes: TaskflowTreeNode[]): string {
  return nodes
    .map((node) => {
      const label = node.contentName ? `${node.contentName}(${node.taskName})` : node.taskName
      if (node.children.length === 0) return label
      return `${label} > [${describeTree(node.children)}]`
    })
    .join(', ')
}

function countTreeNodes(nodes: TaskflowTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countTreeNodes(node.children ?? []), 0)
}

function emphasize(values: string[]): string {
  return values.map((value) => `**${value}**`).join(', ')
}

/** 채팅에 그대로 노출되는 문장. 노드 이름은 ** 로 감싸 프론트가 강조하게 한다. */
function buildAssistantText(roots: TaskflowTreeNode[], notes: ComposeNotes): string {
  const labels: string[] = []
  const collect = (node: TaskflowTreeNode) => {
    labels.push(formatNodeLabel(node.taskName, node.contentName) || node.taskName)
    node.children.forEach(collect)
  }
  roots.forEach(collect)

  const lines = [taskflowMessage(TASKFLOW_MESSAGE_KEY.composeDone, { nodes: emphasize(labels) })]

  if (notes.substituted.length > 0) {
    const pairs = notes.substituted.map((row) => `**${row.requested}** → **${row.resolved}**`).join(', ')
    lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.composeSubstituted, { pairs }))
  }
  if (notes.placeholders.length > 0) {
    const pairs = notes.placeholders.map((row) => `**${row.requested}** → **${row.placedWith}**`).join(', ')
    lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.composePlaceholders, { pairs }))
  }
  if (notes.missing.length > 0) {
    lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.composeMissing, { names: emphasize(notes.missing) }))
  }
  if (notes.unknownProperties.length > 0) {
    lines.push(
      taskflowMessage(TASKFLOW_MESSAGE_KEY.composeUnknownProperties, {
        names: emphasize(Array.from(new Set(notes.unknownProperties))),
      }),
    )
  }
  if (notes.unresolved.length > 0) {
    lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.composeUnresolved, { names: emphasize(notes.unresolved) }))
  }

  return lines.filter(Boolean).join('\n')
}

function toComposeNodes(value: unknown): ComposeNodeArg[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      depth: Number(item.depth),
      taskName: String(item.taskName || '').trim(),
      contentName: item.contentName === undefined ? undefined : String(item.contentName).trim(),
      properties:
        item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties)
          ? (item.properties as Record<string, unknown>)
          : undefined,
    }))
    .filter((item) => Number.isInteger(item.depth) && item.depth >= 0)
    .filter((item) => item.taskName.length > 0 || Boolean(item.contentName))
}

/** depth 순서 위반이면 실패 사유를, 정상이면 depth 0 노드들을 실행 순서대로 반환한다. */
function buildForest(
  nodes: ComposeNodeArg[],
  store: NonNullable<ReturnType<typeof getPropertyTmsStore>>,
  contents: TaskContentRef[],
  notes: ComposeNotes,
): TaskflowTreeNode[] | ComposeFailure {
  if (nodes[0].depth !== 0) {
    return { clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeRootRequired), suggestions: [] }
  }

  const stack: TaskflowTreeNode[] = []
  const roots: TaskflowTreeNode[] = []
  // 생략한 노드의 depth. 그보다 깊은 후속 노드는 자식이므로 함께 버린다.
  let skipDepth: number | null = null

  for (const [index, node] of nodes.entries()) {
    if (index > 0 && node.depth > nodes[index - 1].depth + 1) {
      return { clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeDepthSkipped), suggestions: [] }
    }

    if (skipDepth !== null) {
      if (node.depth > skipDepth) continue
      skipDepth = null
    }

    const taskKnown = node.taskName.length > 0 && Boolean(store.get(node.taskName))

    // taskName 을 명시했는데 카탈로그에 없으면 다른 Task 로 넘어가지 않는다.
    if (node.taskName.length > 0 && !taskKnown) {
      notes.missing.push(node.taskName)
      skipDepth = node.depth
      continue
    }

    // 콘텐츠 이름이 있으면 실제 팔레트에서 찾아 Task 를 역추적하고 contentId 까지 확정한다.
    const contentRef = node.contentName ? findContentRef(node.contentName, node.taskName, contents) : undefined
    // Pause/Wait/Rotate 처럼 콘텐츠가 없는 Task 는 이름 자체가 노드다. "pause 추가" 를 콘텐츠로 찾으면 실패한다.
    const contentNameIsTask = node.contentName ? Boolean(store.get(node.contentName)) : false
    const effectiveTaskName = taskKnown
      ? node.taskName
      : contentRef?.taskName ?? (contentNameIsTask ? node.contentName : undefined)
    const semantics = effectiveTaskName ? store.get(effectiveTaskName) : undefined

    if (!semantics) {
      notes.missing.push(String(node.contentName))
      skipDepth = node.depth
      continue
    }

    const treeNode: TaskflowTreeNode = {
      taskName: semantics.taskName,
      taskType: semantics.taskType,
      children: [],
    }
    // 속성은 스키마(property_tms.compose_hint.properties)에 있는 키만 남긴다.
    if (node.properties) {
      const resolvedProperties = resolveProperties(semantics, node.properties)
      if (Object.keys(resolvedProperties.properties).length > 0) treeNode.properties = resolvedProperties.properties
      notes.unknownProperties.push(...resolvedProperties.unknownKeys)
    }
    if (contentRef && node.contentName) {
      treeNode.contentName = contentRef.contentName
      treeNode.contentId = contentRef.contentId

      if (toMatchKey(contentRef.contentName) !== toMatchKey(node.contentName)) {
        notes.substituted.push({ requested: node.contentName, resolved: contentRef.contentName })
      }
    } else if (node.contentName && toMatchKey(node.contentName) !== toMatchKey(semantics.taskName)) {
      // 대상을 못 찾아도 구조는 만든다. 같은 Task 의 다른 콘텐츠로 임시 채우고 응답에 경고를 남긴다.
      const placeholder = contents.find((row) => toMatchKey(row.taskName) === toMatchKey(semantics.taskName))
      if (!placeholder) {
        notes.missing.push(node.contentName)
        skipDepth = node.depth
        continue
      }

      treeNode.contentName = placeholder.contentName
      treeNode.contentId = placeholder.contentId
      notes.placeholders.push({ requested: node.contentName, placedWith: placeholder.contentName })
    }

    if (node.depth === 0) {
      roots.push(treeNode)
      stack.length = 0
      stack.push(treeNode)
      continue
    }

    const parent = stack[node.depth - 1]
    if (!parent) {
      return { clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeParentMissing), suggestions: [] }
    }

    parent.children.push(treeNode)
    stack.length = node.depth
    stack.push(treeNode)
  }

  if (roots.length === 0) {
    return {
      clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeTaskNotFound),
      suggestions: notes.missing
        .flatMap((name) => findSuggestions(name, store.list()))
        .slice(0, taskflowMessageNumber(TASKFLOW_MESSAGE_KEY.composeSuggestionLimit)),
    }
  }

  return roots
}

/** 동시 실행 요청인데 LLM 이 동작만 나열한 경우, 제어 노드로 묶어 준다.
 * "~하면서 ~하고" 를 순차 연결로 내려주는 일이 있어 프롬프트만으로는 보장되지 않는다.
 * 판단 문구는 rule 테이블(concurrentHintKeywords), 묶을 Task 는 property_tms(compose_hint.intent)에서 온다.
 */
export async function wrapConcurrentRootsIfNeeded(
  roots: TaskflowTreeNode[],
  store: NonNullable<ReturnType<typeof getPropertyTmsStore>>,
  ctx: ToolContext,
): Promise<TaskflowTreeNode[]> {
  if (roots.length < 2) return roots
  // 이미 제어 노드를 세운 응답은 그대로 존중한다.
  if (roots.some((root) => root.taskType === TASK_TYPE.control)) return roots

  const message = String((ctx.context as Record<string, unknown> | undefined)?.__userMessage ?? '').trim()
  if (!message) return roots

  const rules = await loadTaskflowClassifierRules(TASKFLOW_CANVAS_SCREEN_KEY)
  const hints = Array.isArray(rules?.concurrentHintKeywords) ? rules.concurrentHintKeywords : []
  if (hints.length === 0 || !includesConfiguredPhrase(message, hints)) return roots

  const controlName = findTaskNamesByIntent(store.list(), 'concurrent')[0]
  const semantics = controlName ? store.get(controlName) : undefined
  if (!semantics) {
    ctx.log?.log(`[${TOOL_NAME}] concurrent-wrap skipped reason=compose_hint.intent=concurrent 인 Task 가 없다`)
    return roots
  }

  ctx.log?.log(`[${TOOL_NAME}] concurrent-wrap applied control=${semantics.taskName} children=${roots.length}`)

  return [
    {
      taskName: semantics.taskName,
      taskType: semantics.taskType,
      children: roots,
    },
  ]
}

/** CONTROL 인데 자식이 없는 노드 이름을 모은다. 자식 개수 상한 같은 세부 규칙은 tms 앱이 검증한다. */
function collectEmptyControls(node: TaskflowTreeNode, found: string[]): string[] {
  if (node.taskType === TASK_TYPE.control && node.children.length === 0) {
    found.push(node.taskName)
  }

  for (const child of node.children) {
    collectEmptyControls(child, found)
  }

  return found
}

type ComposeInsertOp = {
  after: string
  step: {
    label: string
    taskName: string
    taskType?: string
    contentName?: string
    contentId?: number
    properties?: Record<string, unknown>
  }
  appendOnly: true
  sourceHandle: 'left' | 'right'
  targetHandle: 'left'
  afterCreatedIndex?: number
  placement?: 'right-of-all'
}

/** 캔버스에 이미 노드가 있을 때, roots 트리를 edit_taskflow 와 같은 insertAfter 목록으로 펼친다.
 * 전체를 새로 그리는 replace 가 아니라, 현재 흐름 우측 끝에 이어붙인다.
 */
function flattenTreeToInsertOps(roots: TaskflowTreeNode[]): ComposeInsertOp[] {
  const ops: ComposeInsertOp[] = []

  const toStep = (node: TaskflowTreeNode) => ({
    label: node.contentName || node.taskName,
    taskName: node.taskName,
    taskType: node.taskType,
    contentName: node.contentName,
    contentId: node.contentId,
    ...(node.properties ? { properties: node.properties } : {}),
  })

  const walkChildren = (node: TaskflowTreeNode, parentIndex: number) => {
    for (const child of node.children ?? []) {
      ops.push({
        after: '',
        afterCreatedIndex: parentIndex,
        step: toStep(child),
        appendOnly: true,
        sourceHandle: 'left',
        targetHandle: 'left',
      })
      walkChildren(child, ops.length - 1)
    }
  }

  let previousRootIndex: number | undefined
  for (const root of roots) {
    ops.push({
      after: '',
      step: toStep(root),
      appendOnly: true,
      sourceHandle: 'right',
      targetHandle: 'left',
      ...(previousRootIndex !== undefined ? { afterCreatedIndex: previousRootIndex } : { placement: 'right-of-all' }),
    })
    const rootIndex = ops.length - 1
    walkChildren(root, rootIndex)
    previousRootIndex = rootIndex
  }

  return ops
}

export function createComposeTaskflowTool(): ToolDefinition | null {
  const store = getPropertyTmsStore()
  if (!store) return null

  const catalogText = store.buildCatalogText()
  if (!catalogText) return null

  // 설명은 prompt 테이블에서 온다. 행이 없으면 tool 을 등록하지 않아 설정 누락이 드러나게 한다.
  const description = buildDescription(catalogText, store.list())
  if (!description) return null

  return {
    declaration: {
      name: TOOL_NAME,
      description,
      parameters: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            description: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeParamNodes),
            items: {
              type: 'object',
              properties: {
                depth: { type: 'integer', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeParamDepth) },
                taskName: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeParamTaskName) },
                contentName: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeParamContentName) },
                properties: { type: 'object', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeParamProperties) },
              },
              required: ['depth'],
            },
          },
        },
        required: ['nodes'],
      },
    },

    execute: async (args: Record<string, any>, ctx: ToolContext) => {
      // 비활성 Task 의 콘텐츠가 먼저 잡혀 역추적이 실패하지 않도록 카탈로그에 있는 Task 로 한정한다.
      const contents = readTaskContents(ctx).filter((row) => Boolean(store.get(row.taskName)))
      let nodes = toComposeNodes(args.nodes)

      // orchestrator 의 결정적 경로가 빈 인자로 먼저 호출한다.
      // 이때는 사용자 문장을 절 단위로 갈라 Task/콘텐츠를 직접 찾는다. 그래도 못 만들면 LLM 툴콜 경로로 넘어간다.
      if (nodes.length === 0) {
        const message = String((ctx.context as Record<string, unknown> | undefined)?.__userMessage ?? '').trim()
        if (!message) return {}

        const rules = await loadTaskflowClassifierRules(TASKFLOW_CANVAS_SCREEN_KEY)
        const parsed = parseComposeNodesFromMessage(message, store.list(), contents, {
          clauseSeparatorPhrases: rules?.clauseSeparatorPhrases ?? [],
          clauseNoisePhrases: rules?.clauseNoisePhrases ?? [],
        })

        trace(traceReqId(ctx.context), '4-0.compose-nl-parse', {
          clauses: parsed.clauses.map(
            (row) => `${row.clause} => ${row.taskName ?? '?'}/${row.contentName ?? '-'}(${row.matchedBy ?? 'none'})`,
          ),
          matchedNodes: parsed.nodes.length,
          paletteContents: contents.length,
        })

        if (parsed.nodes.length === 0) return {}
        nodes = toComposeNodes(parsed.nodes)
      }

      // 팔레트가 비면 자식 노드가 전부 버려진다. 여기 0 이면 프론트가 context.taskflow 를 안 보낸 것이다.
      trace(traceReqId(ctx.context), '4-1.compose-input', {
        llmNodes: nodes.map((node) => `${node.depth}:${node.taskName || '?'}/${node.contentName ?? '-'}`),
        paletteContents: contents.length,
        canvasNodes: readCurrentGraph(ctx).nodes.length,
      })

      const notes: ComposeNotes = { missing: [], unresolved: [], substituted: [], placeholders: [], unknownProperties: [] }
      const result = buildForest(nodes, store, contents, notes)
      if ('clarification' in result) {
        ctx.log?.log(`[${TOOL_NAME}] rejected reason=${result.clarification}`)
        return result
      }

      const roots = await wrapConcurrentRootsIfNeeded(result, store, ctx)
      trace(traceReqId(ctx.context), '4-2.compose-tree', {
        beforeWrap: describeTree(result),
        afterWrap: describeTree(roots),
        missing: notes.missing,
        substituted: notes.substituted.map((row) => `${row.requested}->${row.resolved}`),
        placeholders: notes.placeholders.map((row) => `${row.requested}->${row.placedWith}`),
      })

      const emptyControls = roots.flatMap((root) => collectEmptyControls(root, []))
      if (emptyControls.length > 0) {
        return {
          clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.composeEmptyControl, { names: emptyControls.join(', ') }),
          suggestions: [],
        }
      }

      ctx.log?.log(
        `[${TOOL_NAME}] composed roots=${roots.map((root) => root.taskName).join('>')} nodes=${nodes.length} contents=${contents.length}`,
      )
      if (notes.missing.length > 0) {
        ctx.log?.log(`[${TOOL_NAME}] skipped names=${notes.missing.join(', ')}`)
      }
      if (notes.unresolved.length > 0) {
        ctx.log?.log(`[${TOOL_NAME}] content-unresolved names=${notes.unresolved.join(', ')}`)
      }

      // 캔버스에 이미 노드가 있으면 지우고 새로 그리지 않고, 현재 흐름 우측 끝에 이어붙인다.
      const draft = readCurrentGraph(ctx).nodes.length > 0
        ? { mode: 'edit', insertAfter: flattenTreeToInsertOps(roots) }
        : { mode: 'replace', roots }

      markFlowDecision(traceReqId(ctx.context), {
        handler: 'deterministic-compose',
        draftNodeCount: Array.isArray((draft as any).roots)
          ? countTreeNodes((draft as any).roots)
          : Array.isArray((draft as any).insertAfter)
            ? (draft as any).insertAfter.length
            : 0,
      })
      trace(traceReqId(ctx.context), '4-3.compose-draft', {
        mode: draft.mode,
        rootCount: Array.isArray((draft as any).roots) ? (draft as any).roots.length : 0,
        insertCount: Array.isArray((draft as any).insertAfter) ? (draft as any).insertAfter.length : 0,
      })

      const payload: Record<string, unknown> = {
        ...buildApplyDraftAction(draft, ctx, TASKFLOW_MESSAGE_KEY.toolCompose),
        assistantText: buildAssistantText(roots, notes),
      }
      if (notes.missing.length > 0) {
        payload.skippedNodes = notes.missing
      }
      if (notes.substituted.length > 0) {
        payload.substitutedContents = notes.substituted
      }
      if (notes.unresolved.length > 0) {
        payload.unresolvedContents = notes.unresolved
      }

      return payload
    },
  }
}
