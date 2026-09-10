import type { ToolContext, ToolDefinition } from '../tool.type'
import { getPropertyTmsStore, TASK_TYPE, type TaskSemantics } from '../../features/taskflow/service/property-tms-store.service'
import {
  findContentRef,
  findSuggestions,
  formatNodeLabel,
  readCurrentGraph,
  describeTaskProperties,
  readTaskContents,
  findFlowTailNode,
  isConcurrentControlTask,
  readControlChildScope,
  formatNodeTarget,
  resolveProperties,
  fillPropertiesFromMessage,
  toMatchKey,
  TASKFLOW_CANVAS_SCREEN_KEY,
  type TaskContentRef,
} from './taskflow-palette'
import {
  taskflowMessage,
  taskflowNodeGuides,
  TASKFLOW_MESSAGE_KEY,
  TASKFLOW_TOOL_KEY,
} from './taskflow-message'
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
  /** 동시 실행 제어 노드 아래에서 같은 Task 라 넣지 않은 노드 이름. */
  duplicateConcurrent: string[]
  missing: string[]
  unresolved: string[]
  substituted: Array<{ requested: string; resolved: string }>
  /** 대상을 못 찾아 같은 Task 의 다른 콘텐츠로 임시 채운 경우. */
  placeholders: Array<{ requested: string; placedWith: string }>
}

const TOOL_NAME = 'compose_linear_taskflow'

/** 못 찾은 이름에 대해 되묻을 때 함께 보여 줄 후보 개수. 문구가 아니라 표시 한도라 코드에 둔다. */
const SUGGESTION_LIMIT = 3

function readComposeIntents(task: TaskSemantics): string[] {
  const single = String(task.composeHint?.intent ?? '').trim()
  const many = Array.isArray(task.composeHint?.intents) ? task.composeHint.intents : []

  return [single, ...many.map((value) => String(value ?? '').trim())].filter(Boolean)
}

function findTaskNamesByIntent(tasks: TaskSemantics[], intent: string): string[] {
  return tasks.filter((task) => readComposeIntents(task).includes(intent)).map((task) => task.taskName)
}

// 제어 노드 이름을 하드코딩하지 않는다. 카탈로그에 없는 이름을 안내하면 LLM 이 그대로 쓰고 거부된다.
// 노드별 지침(llm.tool.compose.node.<task>)은 카탈로그에 있는 Task 것만 붙는다.
function buildDescription(catalogText: string, tasks: TaskSemantics[]): string {
  return taskflowMessage(TASKFLOW_MESSAGE_KEY.toolCompose, {
    catalog: catalogText,
    nodeGuides: taskflowNodeGuides('compose', tasks.map((task) => task.taskName)),
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
  if (notes.duplicateConcurrent.length > 0) {
    lines.push(
      taskflowMessage(TASKFLOW_MESSAGE_KEY.composeDuplicateConcurrent, { names: emphasize(notes.duplicateConcurrent) }),
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
  message: string,
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
    const resolvedProperties = resolveProperties(semantics, node.properties ?? {})
    notes.unknownProperties.push(...resolvedProperties.unknownKeys)
    // LLM 이 "3초 타임아웃" 의 값을 빠뜨리거나 contentName 에 적어 보내는 일이 있어, 문장의 숫자로 마지막에 채운다.
    const filled = fillPropertiesFromMessage(
      semantics,
      resolvedProperties.properties,
      [message, node.contentName ?? ''].join(' '),
    )
    if (Object.keys(filled.properties).length > 0) treeNode.properties = filled.properties
    if (contentRef && node.contentName) {
      treeNode.contentName = contentRef.contentName
      treeNode.contentId = contentRef.contentId

      if (toMatchKey(contentRef.contentName) !== toMatchKey(node.contentName)) {
        notes.substituted.push({ requested: node.contentName, resolved: contentRef.contentName })
      }
    } else if (semantics.taskType === TASK_TYPE.control) {
      // 제어 노드는 콘텐츠가 없다. LLM 이 "3초" 처럼 값을 contentName 에 적어 보내도 노드는 그대로 만든다.
      // 여기서 버리면 제어 노드와 그 자식이 통째로 사라진다.
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
        .slice(0, SUGGESTION_LIMIT),
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

/** 사용자가 제어 노드를 직접 지목한 문장인지. 이름/ trigger_phrases 는 property_tms 에서 온다.
 *
 * NL 파서는 절을 전부 depth 0 으로만 나열하므로
 * "thumb_up 모션 성공하면 Love 얼굴, 실패하면 Idle 얼굴 보이게 하는 ifThenElse 를 만들어줘" 같은
 * 중첩 요청(제어 노드 + 순서 있는 자식 + 분기 역할)은 결정적 경로로 만들 수 없다.
 * 이런 문장은 LLM 툴콜 경로가 depth 를 붙여 내려주게 넘긴다.
 */
export function mentionsControlTask(
  message: string,
  store: NonNullable<ReturnType<typeof getPropertyTmsStore>>,
): { taskName: string; phraseKey: string } | undefined {
  const messageKey = toMatchKey(message)
  if (!messageKey) return undefined

  for (const task of store.list()) {
    if (task.taskType !== TASK_TYPE.control) continue

    const keys = [task.taskName, ...(task.triggerPhrases ?? [])]
      .map((value) => toMatchKey(String(value ?? '')))
      .filter((value) => value.length >= 2)

    const matched = keys.find((key) => messageKey.includes(key))
    if (matched) return { taskName: task.taskName, phraseKey: matched }
  }

  return undefined
}

/** 제어 노드를 부르는 말이 절 끝에 붙어 다음 절과 이어 주는 접속어인지("~하면서", "~하고 동시에").
 * 이런 말은 뒤 절의 동작까지 함께 묶으라는 뜻이다.
 */
function joinsNextClause(clause: string, phraseKey: string): boolean {
  return toMatchKey(clause).endsWith(phraseKey)
}

/** 동시 실행 제어 노드(Parallel 등) 아래에서 같은 Task 의 자식을 하나만 남긴다.
 * 얼굴 두 개, 발화 두 개를 동시에 수행할 수는 없어서 프론트 연결 규칙도 이를 막는다.
 * 어떤 Task 가 동시 실행인지는 property_tms(compose_hint.intent=concurrent)가 정한다.
 */
function dropDuplicateConcurrentChildren(nodes: TaskflowTreeNode[], notes: ComposeNotes): void {
  for (const node of nodes) {
    if (isConcurrentControlTask(node.taskName)) {
      const usedTasks = new Set<string>()
      node.children = node.children.filter((child) => {
        const key = toMatchKey(child.taskName)
        if (usedTasks.has(key)) {
          notes.duplicateConcurrent.push(formatNodeLabel(child.taskName, child.contentName) || child.taskName)
          return false
        }
        usedTasks.add(key)
        return true
      })
    }

    dropDuplicateConcurrentChildren(node.children, notes)
  }
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
}

/** 캔버스에 이미 노드가 있을 때, roots 트리를 edit_taskflow 와 같은 insertAfter 목록으로 펼친다.
 * 전체를 새로 그리는 replace 가 아니라, Start 에서 이어지는 흐름의 끝(anchorName) 우측에 이어붙인다.
 * 기존 노드는 건드리지 않고 엣지만 하나 늘어난다.
 */
function flattenTreeToInsertOps(roots: TaskflowTreeNode[], anchorName: string): ComposeInsertOp[] {
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
      after: previousRootIndex === undefined ? anchorName : '',
      step: toStep(root),
      appendOnly: true,
      sourceHandle: 'right',
      targetHandle: 'left',
      ...(previousRootIndex !== undefined ? { afterCreatedIndex: previousRootIndex } : {}),
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

        // 제어 노드를 지목한 문장이면 동작을 말한 순서대로 그 자식으로 넣는다.
        // NL 파서는 절을 depth 0 으로만 나열하므로 중첩은 여기서 만든다.
        // (IfThenElse 의 condition/success/failure 역할은 tms 앱이 자식 순서로 정한다.)
        const control = mentionsControlTask(message, store)
        const actionNodes = parsed.nodes.filter((node) => store.get(node.taskName)?.taskType !== TASK_TYPE.control)
        // 제어 노드를 부른 절. 반복/지연처럼 자기 절만 품는 제어 노드는 이 절이 기준이다.
        const controlClauseIndex = control
          ? Math.max(
              parsed.clauses.findIndex((row) => mentionsControlTask(row.clause, store)?.taskName === control.taskName),
              0,
            )
          : -1
        const childScope = control ? readControlChildScope(control.taskName) : 'all'
        // 자식으로 묶는 절 범위. all 이면 제어 노드를 부른 절까지(접속어면 다음 절까지) 함께 묶고,
        // clause 면 그 절의 동작만 자식으로 둔다. 범위 밖 절은 제어 노드 앞/뒤 순서로 남는다.
        const controlClause = controlClauseIndex >= 0 ? parsed.clauses[controlClauseIndex]?.clause ?? '' : ''
        const lastChildClause =
          childScope === 'all'
            ? controlClauseIndex + (control && joinsNextClause(controlClause, control.phraseKey) ? 1 : 0)
            : controlClauseIndex
        const firstChildClause = childScope === 'all' ? 0 : controlClauseIndex
        const isChildClause = (index: number) => index >= firstChildClause && index <= lastChildClause

        const parsedNodes = control
          ? [
              // 자식 범위보다 앞 절에서 말한 동작은 제어 노드 앞에 그대로 둔다.
              ...actionNodes.filter((node) => node.clauseIndex < firstChildClause),
              { depth: 0, taskName: control.taskName, clauseIndex: controlClauseIndex },
              ...actionNodes.filter((node) => isChildClause(node.clauseIndex)).map((node) => ({ ...node, depth: 1 })),
              // 뒤 절에서 말한 동작은 제어 노드 다음 순서로 잇는다.
              ...actionNodes.filter((node) => node.clauseIndex > lastChildClause),
            ]
          : parsed.nodes

        // 제어 노드만 남았으면 무엇을 자식으로 둘지 알 수 없다. LLM 툴콜 경로로 넘긴다.
        if (control && !parsedNodes.some((node) => node.depth === 1)) {
          ctx.log?.log(`[${TOOL_NAME}] nl-parse skipped reason=제어 노드의 자식을 찾지 못함 control=${control.taskName}`)
          return {}
        }
        if (control) {
          ctx.log?.log(
            `[${TOOL_NAME}] nl-parse control=${control.taskName} scope=${childScope} clauses=${firstChildClause}..${lastChildClause}`,
          )
        }

        nodes = toComposeNodes(parsedNodes)
      }

      // 팔레트가 비면 자식 노드가 전부 버려진다. 여기 0 이면 프론트가 context.taskflow 를 안 보낸 것이다.
      trace(traceReqId(ctx.context), '4-1.compose-input', {
        llmNodes: nodes.map((node) => `${node.depth}:${node.taskName || '?'}/${node.contentName ?? '-'}`),
        paletteContents: contents.length,
        canvasNodes: readCurrentGraph(ctx).nodes.length,
      })

      const notes: ComposeNotes = {
        missing: [],
        unresolved: [],
        substituted: [],
        placeholders: [],
        unknownProperties: [],
        duplicateConcurrent: [],
      }
      const userMessage = String((ctx.context as Record<string, unknown> | undefined)?.__userMessage ?? '').trim()
      const result = buildForest(nodes, store, contents, notes, userMessage)
      if ('clarification' in result) {
        ctx.log?.log(`[${TOOL_NAME}] rejected reason=${result.clarification}`)
        return result
      }

      const roots = await wrapConcurrentRootsIfNeeded(result, store, ctx)
      dropDuplicateConcurrentChildren(roots, notes)
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

      // 캔버스에 이미 노드가 있으면 지우고 새로 그리지 않고, Start 에서 이어지는 흐름의 끝에 이어붙인다.
      const graph = readCurrentGraph(ctx)
      const tailNode = findFlowTailNode(graph)
      const draft = graph.nodes.length > 0 && tailNode
        ? { mode: 'edit', insertAfter: flattenTreeToInsertOps(roots, formatNodeTarget(tailNode)) }
        : { mode: 'replace', roots }
      if (tailNode) {
        trace(traceReqId(ctx.context), '4-2-1.compose-anchor', { tail: formatNodeTarget(tailNode) })
      }

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
        ...buildApplyDraftAction(draft, ctx, TASKFLOW_TOOL_KEY.compose),
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
