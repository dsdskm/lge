import type { ToolContext, ToolDefinition } from '../tool.type'
import { getPropertyTmsStore, TASK_TYPE } from '../../features/taskflow/service/property-tms-store.service'
import {
  describeGraphNode,
  describeGraphNodeForUser,
  describeTaskProperties,
  findContentRef,
  findGraphNodes,
  formatNodeTarget,
  parseNodeTarget,
  readCurrentGraph,
  resolveTaskAlias,
  readTaskContents,
  findFlowTailNode,
  findClosestTaskName,
  isConcurrentControlTask,
  readConcurrentChildTaskNames,
  resolveContentByLooseName,
  resolveProperties,
  fillPropertiesFromMessage,
  toMatchKey,
  TASKFLOW_CANVAS_SCREEN_KEY,
  type CurrentGraph,
  type GraphNodeRef,
  type NodeTargetRules,
  type TaskContentRef,
} from './taskflow-palette'
import { includesConfiguredPhrase, loadTaskflowLanguageRules } from '../taskflow-language-rules'
import { taskflowMessage, taskflowNodeGuides, TASKFLOW_MESSAGE_KEY, TASKFLOW_TOOL_KEY } from './taskflow-message'
import { buildApplyDraftAction } from './taskflow-client-action'
import { trace, traceReqId } from '../trace.util'

const TOOL_NAME = 'edit_taskflow'

/** 제어 노드가 자식에게 주는 역할. Parallel 은 main, IfThenElse 는 condition/success/failure 를 쓴다. */
const NODE_ROLES = ['main', 'condition', 'success', 'failure'] as const

type EditAction = 'insert' | 'replace' | 'remove' | 'clone_all' | 'set_property' | 'set_role'

type EditOperationArg = {
  action: EditAction
  target: string
  after: string
  taskName: string
  contentName: string
  branch: boolean
  all: boolean
  refId: string
  /** Delay 의 delay_msec 처럼 노드에 값으로 지정하는 속성. 스키마에 있는 키만 반영된다. */
  properties: Record<string, unknown>
  /** set_role 에서 역할을 줄 자식 노드 이름. */
  child: string
  /** set_role 에서 줄 역할. main / condition / success / failure */
  role: string
}

/** 프론트 applyEditDraftToFlowDefinition 이 그대로 소비하는 스텝. */
type DraftStep = {
  label: string
  taskName: string
  taskType?: string
  contentName?: string
  contentId?: number
  taskId?: number
  /** 요청한 대상을 못 찾아 같은 Task 의 다른 콘텐츠로 임시 채운 경우 원래 요청한 이름. */
  placeholderFor?: string
  /** 프론트가 기본값 위에 덮어쓸 속성. */
  properties?: Record<string, unknown>
}

// 노드별 지침(llm.tool.edit.node.<task>)은 카탈로그에 있는 Task 것만 {{nodeGuides}} 자리에 붙는다.
function buildDescription(catalogText: string, propertyCatalogText: string, taskNames: string[]): string {
  return taskflowMessage(TASKFLOW_MESSAGE_KEY.toolEdit, {
    catalog: catalogText,
    propertyCatalog: propertyCatalogText,
    nodeGuides: taskflowNodeGuides('edit', taskNames),
  })
}

function appendedMessage(branch: boolean, anchor: string, label: string): string {
  const key = branch ? TASKFLOW_MESSAGE_KEY.editAppliedAppendBranch : TASKFLOW_MESSAGE_KEY.editAppliedAppendAfter
  return taskflowMessage(key, { anchor, label })
}

/** 못 찾은 대상 이름. 비어 있으면 다른 필드로 대신 채워 "무엇을" 못 찾았는지가 항상 남게 한다. */
function missingName(...candidates: string[]): string {
  return candidates.map((value) => String(value ?? '').trim()).find(Boolean) ?? ''
}

/** "delay_msec=3000" 처럼 사용자에게 보여 줄 속성 표기. */
function describePropertyPairs(properties: Record<string, unknown>): string {
  return Object.entries(properties)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

/** 후보가 여러 개인 대상 이름. 표기만 하므로 코드에 둔다. */
function ambiguousEntry(name: string, _options: string[]): string {
  return name
}

function emphasize(values: string[]): string {
  return values.map((value) => `**${value}**`).join(', ')
}

function toEditOperations(value: unknown): EditOperationArg[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      action: String(item.action || '').trim() as EditAction,
      target: String(item.target || '').trim(),
      after: String(item.after || '').trim(),
      taskName: String(item.taskName || '').trim(),
      contentName: String(item.contentName || '').trim(),
      branch: Boolean(item.branch),
      all: Boolean(item.all),
      refId: String(item.refId || '').trim(),
      properties:
        item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties)
          ? (item.properties as Record<string, unknown>)
          : {},
      child: String(item.child || '').trim(),
      role: String(item.role || '').trim().toLowerCase(),
    }))
    .filter(
      (item) =>
        item.action === 'insert' ||
        item.action === 'replace' ||
        item.action === 'remove' ||
        item.action === 'clone_all' ||
        item.action === 'set_property' ||
        item.action === 'set_role',
    )
}

type TargetResolution =
  | { kind: 'ok'; nodes: GraphNodeRef[] }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; options: string[] }

/** 번호나 all 이 없는데 동명 노드가 여러 개면 임의로 고르지 않고 되묻는다. */
function resolveTargetNodes(name: string, graph: CurrentGraph, all: boolean, rules: NodeTargetRules): TargetResolution {
  const matched = findGraphNodes(name, graph, rules)
  if (matched.length === 0) return { kind: 'missing' }
  if (all || matched.length === 1) return { kind: 'ok', nodes: matched }

  return { kind: 'ambiguous', options: matched.map(describeGraphNodeForUser) }
}

/** 앞선 operation 이 만든 노드 이름과 같으면 그걸 기준으로 쓴다. 프론트가 순서대로 적용하며 찾아낸다. */
function findPendingLabel(name: string, createdLabels: string[], rules: NodeTargetRules): string | undefined {
  const key = toMatchKey(parseNodeTarget(name, rules).name)
  if (!key) return undefined

  return [...createdLabels].reverse().find((label) => toMatchKey(label) === key)
}

function resolveStep(
  taskName: string,
  contentName: string,
  store: NonNullable<ReturnType<typeof getPropertyTmsStore>>,
  contents: TaskContentRef[],
  requestedProperties: Record<string, unknown> = {},
  unknownPropertyKeys: string[] = [],
  message = '',
): DraftStep | null {
  const contentRef = contentName ? findContentRef(contentName, taskName, contents) : undefined
  // "타임아웃" 처럼 사람이 부르는 이름으로 와도 Task 를 찾는다. 별칭은 property_tms.trigger_phrases 에 있다.
  const aliasTaskName = taskName ? resolveTaskAlias(taskName) : ''
  // Pause/Wait/Rotate 처럼 콘텐츠가 없는 Task 는 이름 자체가 노드다. "pause 추가" 를 콘텐츠로 찾으면 실패한다.
  const contentAsTaskName = contentName ? resolveTaskAlias(contentName) : ''
  const contentNameIsTask = contentAsTaskName ? Boolean(store.get(contentAsTaskName)) : false
  const effectiveTaskName = store.get(aliasTaskName)
    ? aliasTaskName
    : contentRef?.taskName ??
      (contentNameIsTask ? contentAsTaskName : undefined) ??
      // 팔레트에도 Task 이름에도 없으면 마지막으로 오타를 감안한다("puase" -> Pause).
      // 팔레트를 먼저 본 뒤라서 콘텐츠 이름("Love")이 Task 표현("move")으로 넘어가지 않는다.
      (contentName && resolveContentByLooseName(contentName, contents)
        ? undefined
        : findClosestTaskName(taskName || contentName))
  const semantics = effectiveTaskName ? store.get(effectiveTaskName) : undefined
  if (!semantics) return null

  // 속성은 스키마(property_tms.compose_hint.properties)에 있는 키만 남긴다.
  const resolved = resolveProperties(semantics, requestedProperties)
  unknownPropertyKeys.push(...resolved.unknownKeys)
  // LLM 이 "3초 타임아웃" 의 값을 빠뜨리면 사용자 문장의 숫자로 채운다(단위 배수는 property_tms 가 정한다).
  const filled = fillPropertiesFromMessage(semantics, resolved.properties, [message, contentName].join(' '))
  const properties = Object.keys(filled.properties).length > 0 ? filled.properties : undefined

  if (contentRef) {
    return {
      label: contentRef.contentName,
      taskName: semantics.taskName,
      taskType: semantics.taskType,
      contentName: contentRef.contentName,
      contentId: contentRef.contentId,
      taskId: contentRef.taskId,
      ...(properties ? { properties } : {}),
    }
  }

  // "인트로 tts" 처럼 Task 를 부르는 말이 섞여 있으면 그것을 떼고 다시 찾는다.
  if (contentName && semantics.taskType !== TASK_TYPE.control) {
    const loose = resolveContentByLooseName(contentName, contents)
    if (loose) {
      return {
        label: loose.contentName,
        taskName: loose.taskName,
        taskType: store.get(loose.taskName)?.taskType,
        contentName: loose.contentName,
        contentId: loose.contentId,
        taskId: loose.taskId,
        ...(properties ? { properties } : {}),
      }
    }
  }

  // 대상을 지정했는데 팔레트에 없으면, 같은 Task 의 다른 콘텐츠로 임시 채우고 사용자가 바꾸게 한다.
  // 구조가 없으면 뒤이어지는 요청(자식 추가 등)이 전부 막힐 수 있어 임의로 따지지 않고 구조부터 유지한다.
  // 제어 노드는 콘텐츠가 없다. LLM 이 "3초" 처럼 값을 contentName 에 적어 보내도 노드는 그대로 만든다.
  if (
    contentName &&
    semantics.taskType !== TASK_TYPE.control &&
    toMatchKey(contentAsTaskName) !== toMatchKey(semantics.taskName)
  ) {
    const placeholder = contents.find((row) => toMatchKey(row.taskName) === toMatchKey(semantics.taskName))
    if (!placeholder) return null

    return {
      label: placeholder.contentName,
      taskName: semantics.taskName,
      taskType: semantics.taskType,
      contentName: placeholder.contentName,
      contentId: placeholder.contentId,
      taskId: placeholder.taskId,
      placeholderFor: contentName,
      ...(properties ? { properties } : {}),
    }
  }

  // 콘텐츠를 지정하지 않은 제어 노드는 Task 이름 자체가 팔레트 라벨이다.
  return {
    label: semantics.taskName,
    taskName: semantics.taskName,
    taskType: semantics.taskType,
    ...(properties ? { properties } : {}),
  }
}

export function createEditTaskflowTool(): ToolDefinition | null {
  const store = getPropertyTmsStore()
  if (!store) return null

  const catalogText = store.buildCatalogText()
  if (!catalogText) return null

  // 설명은 prompt 테이블에서 온다. 행이 없으면 tool 을 등록하지 않아 설정 누락이 드러나게 한다.
  const description = buildDescription(
    catalogText,
    describeTaskProperties(store.list()),
    store.list().map((task) => task.taskName),
  )
  if (!description) return null

  return {
    declaration: {
      name: TOOL_NAME,
      description,
      parameters: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamOperations),
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamAction) },
                target: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamTarget) },
                after: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamAfter) },
                taskName: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamTaskName) },
                contentName: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamContentName) },
                branch: { type: 'boolean', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamBranch) },
                all: { type: 'boolean', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamAll) },
                refId: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamRefId) },
                properties: { type: 'object', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamProperties) },
                child: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamChild) },
                role: { type: 'string', description: taskflowMessage(TASKFLOW_MESSAGE_KEY.editParamRole) },
              },
              required: ['action'],
            },
          },
        },
        required: ['operations'],
      },
    },

    execute: async (args: Record<string, any>, ctx: ToolContext) => {
      const operations = toEditOperations(args.operations)
      if (operations.length === 0) return {}

      // "3초 타임아웃" 처럼 LLM 이 값을 빠뜨렸을 때 문장의 숫자로 채우는 데 쓴다.
      const userMessage = String((ctx.context as Record<string, unknown> | undefined)?.__userMessage ?? '').trim()

      // 순번 표기("두번째" 등)는 rule 테이블에서 읽어 코드에 언어별 문구를 두지 않는다.
      const languageRules = await loadTaskflowLanguageRules(TASKFLOW_CANVAS_SCREEN_KEY)
      const nodeTargetRules: NodeTargetRules = {
        ordinalWords: languageRules.nodeTargetOrdinalWords,
        ordinalSuffixPhrases: languageRules.nodeTargetOrdinalSuffixPhrases,
        nounPhrases: languageRules.nodeTargetNounPhrases,
      }

      const graph: CurrentGraph = readCurrentGraph(ctx)
      // "우측/뒤/다음" 이라고 말했는지. 제어 노드에 붙일 때 자식이냐 다음 순서냐를 가른다.
      const attachesToRightSide = includesConfiguredPhrase(userMessage, languageRules.nodeAttachRightPhrases)
      // 위치를 말하지 않은 추가 요청의 기준 노드. Start 에서 이어지는 흐름의 끝이다.
      const flowTailNode = findFlowTailNode(graph)
      const flowTailName = flowTailNode ? formatNodeTarget(flowTailNode) : ''
      ctx.log?.log(
        `[${TOOL_NAME}] ops=${JSON.stringify(operations)} graphNodes=${graph.nodes.map(describeGraphNode).join(' | ') || '-'}`,
      )
      // 빈 캔버스에서도 "X 노드 추가해줘" 는 그냥 만들어 주면 된다.
      // 기준 노드가 필요한 작업(삭제/교체/복제)만 먼저 구성하라고 안내한다.
      const insertOnly = operations.every((operation) => operation.action === 'insert')
      if (graph.nodes.length === 0 && !insertOnly) {
        return { clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.editEmptyCanvas), suggestions: [] }
      }

      trace(traceReqId(ctx.context), '4-1.edit-input', {
        operations: operations.map((operation) => `${operation.action}:${operation.target || operation.contentName || operation.taskName}${operation.branch ? '(branch)' : ''}`),
        canvasNodes: graph.nodes.map(describeGraphNode),
      })

      const contents = readTaskContents(ctx).filter((row) => Boolean(store.get(row.taskName)))

      const removeByName: string[] = []
      const replaceByName: Array<{ target: string; step: DraftStep }> = []
      const insertAfter: Array<{
        after: string
        step: DraftStep
        appendOnly: boolean
        sourceHandle: 'left' | 'right'
        targetHandle: 'left'
        afterCreatedIndex?: number
        /** 캔버스 우측 끝으로 밀어내 기존과 겹치지 않게 배치해야 하는 경우(전체 복제 등). */
        placement?: 'right-of-all'
      }> = []
      const applied: string[] = []
      const missing: string[] = []
      const ambiguous: string[] = []
      // 스키마에 없어 버린 속성 키. 사용자에게 그대로 알린다.
      const unknownProperties: string[] = []
      // 기존 노드의 속성만 바꾸는 작업.
      const updateProperties: Array<{ target: string; properties: Record<string, unknown> }> = []
      // 제어 노드가 자식에게 주는 역할(main / condition / success / failure).
      const setRoles: Array<{ target: string; child: string; role: string }> = []
      const createdLabels: string[] = []
      // 요청한 대상을 못 찾아 다른 콘텐츠로 임시 채운 경우. 채팅에 그대로 노출해 바꿔야 함을 알린다.
      const placeholders: string[] = []
      // 동시 실행 제어 노드마다 이번 호출에서 이미 붙인 자식 Task. 같은 Task 를 두 번 붙이지 않는다.
      const concurrentChildTasksByAnchor = new Map<string, string[]>()
      const duplicateConcurrent: string[] = []
      // refId -> 그 노드를 만드는 insertAfter 인덱스. 동명 노드를 여러 개 만들 때 섞이지 않게 한다.
      const insertIndexByRefId = new Map<string, number>()

      /** 지목한 노드를 찾고, 못 찾거나 여러 개면 사용자에게 알릴 목록에 담는다.
       * 찾은 노드가 없으면 null 을 주니 호출부는 그때 continue 하면 된다.
       */
      const takeTargetNodes = (name: string, all: boolean): GraphNodeRef[] | null => {
        const resolved = resolveTargetNodes(name, graph, all, nodeTargetRules)
        const requested = parseNodeTarget(name, nodeTargetRules).name

        if (resolved.kind === 'missing') {
          missing.push(missingName(requested, name))
          return null
        }
        if (resolved.kind === 'ambiguous') {
          ambiguous.push(ambiguousEntry(requested, resolved.options))
          return null
        }

        return resolved.nodes
      }

      // 흐름 맨 끝을 기준으로 삼는 요청은 after 를 비워 프론트가 꼬리 노드를 찾게 한다.
      // 빈 캔버스에서는 기준으로 삼을 노드가 없으니 after 를 무시하고 Start 뒤에 붙인다.
      const tailIsExplicit = (operation: EditOperationArg) =>
        operation.after.length > 0 && graph.nodes.length > 0
      // 이번 호출에서 마지막으로 만든 제어 노드의 insert 인덱스.
      // 자식 추가인데 기준을 안 적었으면 그 제어 노드에 매달아야 한다.
      // 이름으로만 두면 프론트가 "제어 노드와 그 자식" 둘을 꼬리로 보고 모호하다며 전체를 취소한다.
      let lastControlInsertIndex: number | undefined

      for (const operation of operations) {
        if (operation.action === 'clone_all') {
          const nodeIds = new Set(graph.nodes.map((node) => node.id))
          const incomingCount = new Map<string, number>()
          const outgoingByNode = new Map<string, Array<{ target: string; branch: boolean }>>()
          for (const node of graph.nodes) incomingCount.set(node.id, 0)
          for (const edge of graph.edges) {
            if (!nodeIds.has(edge.target) || !nodeIds.has(edge.source)) continue
            incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
            const entry = { target: edge.target, branch: edge.branch }
            const bucket = outgoingByNode.get(edge.source)
            if (bucket) bucket.push(entry)
            else outgoingByNode.set(edge.source, [entry])
          }

          // 다른 노드 안에서 오지 않는 노드(= start 바로 다음)가 복제된 흐름의 시작점이다.
          const roots = graph.nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0).map((node) => node.id)
          if (roots.length === 0) {
            missing.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editCloneTargetMissing))
            continue
          }

          const cloneRefByOriginalId = new Map<string, string>()
          let cloneSeq = 0
          const rootAnchorResolved = tailIsExplicit(operation)
            ? resolveTargetNodes(operation.after, graph, false, nodeTargetRules)
            : undefined

          const enqueueClone = (originalId: string, parentRef: string, branch: boolean): boolean => {
            const original = graph.nodes.find((node) => node.id === originalId)
            if (!original) return false

            const step = resolveStep(original.taskName ?? '', original.contentName ?? '', store, contents)
            if (!step) {
              missing.push(original.label)
              return false
            }

            cloneSeq += 1
            const refId = `clone-${cloneSeq}`
            cloneRefByOriginalId.set(originalId, refId)

            if (parentRef) {
              insertAfter.push({
                after: '',
                afterCreatedIndex: insertIndexByRefId.get(parentRef),
                step,
                appendOnly: true,
                sourceHandle: branch ? 'left' : 'right',
                targetHandle: 'left',
                placement: 'right-of-all',
              })
            } else {
              insertAfter.push({
                after: rootAnchorResolved?.kind === 'ok' ? formatNodeTarget(rootAnchorResolved.nodes[0]) : '',
                step,
                appendOnly: true,
                sourceHandle: branch ? 'left' : 'right',
                targetHandle: 'left',
                placement: 'right-of-all',
              })
            }

            insertIndexByRefId.set(refId, insertAfter.length - 1)
            applied.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editAppliedClone, { node: describeGraphNodeForUser(original) }))
            return true
          }

          if (tailIsExplicit(operation) && rootAnchorResolved?.kind === 'missing') {
            missing.push(missingName(parseNodeTarget(operation.after, nodeTargetRules).name, operation.after))
            continue
          }
          if (tailIsExplicit(operation) && rootAnchorResolved?.kind === 'ambiguous') {
            ambiguous.push(ambiguousEntry(parseNodeTarget(operation.after, nodeTargetRules).name, rootAnchorResolved.options))
            continue
          }

          for (const rootId of roots) {
            const queue: Array<{ id: string; parentRef: string; branch: boolean }> = [
              { id: rootId, parentRef: '', branch: operation.branch },
            ]

            while (queue.length > 0) {
              const current = queue.shift()
              if (!current) continue

              const ok = enqueueClone(current.id, current.parentRef, current.branch)
              if (!ok) continue

              const newParentRef = cloneRefByOriginalId.get(current.id) ?? ''
              const outgoing = outgoingByNode.get(current.id) ?? []
              // 다음(순차) 먼저, 자식(분기)은 그 다음. Start 기준 순서와 같은 규칙을 쓴다.
              const ordered = [...outgoing.filter((edge) => !edge.branch), ...outgoing.filter((edge) => edge.branch)]
              for (const edge of ordered) {
                queue.push({ id: edge.target, parentRef: newParentRef, branch: edge.branch })
              }
            }
          }
          continue
        }

        if (operation.action === 'set_role') {
          const role = NODE_ROLES.find((item) => item === operation.role)
          if (!role || !operation.child) {
            missing.push(missingName(operation.role, operation.child, operation.target))
            continue
          }

          const roleTargets = takeTargetNodes(operation.target, operation.all)
          if (!roleTargets) continue

          // 자식은 프론트가 만든 id 로만 특정할 수 있어 이름만 넘긴다. id 변환은 프론트가 한다.
          for (const node of roleTargets) {
            setRoles.push({ target: formatNodeTarget(node), child: operation.child, role })
            applied.push(
              taskflowMessage(TASKFLOW_MESSAGE_KEY.editAppliedRole, {
                node: describeGraphNodeForUser(node),
                child: operation.child,
                role,
              }),
            )
          }
          continue
        }

        if (operation.action === 'set_property') {
          const propertyTargets = takeTargetNodes(operation.target, operation.all)
          if (!propertyTargets) continue

          for (const node of propertyTargets) {
            const semantics = node.taskName ? store.get(node.taskName) : undefined
            const applyResult = resolveProperties(semantics, operation.properties)
            unknownProperties.push(...applyResult.unknownKeys)
            if (Object.keys(applyResult.properties).length === 0) continue

            updateProperties.push({ target: formatNodeTarget(node), properties: applyResult.properties })
            applied.push(
              taskflowMessage(TASKFLOW_MESSAGE_KEY.editAppliedProperty, {
                node: describeGraphNodeForUser(node),
                properties: describePropertyPairs(applyResult.properties),
              }),
            )
          }
          continue
        }

        if (operation.action === 'remove') {
          const removeTargets = takeTargetNodes(operation.target, operation.all)
          if (!removeTargets) continue

          for (const node of removeTargets) {
            removeByName.push(formatNodeTarget(node))
            applied.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editAppliedRemove, { node: describeGraphNodeForUser(node) }))
          }
          continue
        }

        const step = resolveStep(
          operation.taskName,
          operation.contentName,
          store,
          contents,
          operation.properties,
          unknownProperties,
          userMessage,
        )
        if (!step) {
          missing.push(missingName(operation.contentName, operation.taskName, operation.target, operation.after))
          continue
        }
        if (step.placeholderFor) {
          placeholders.push(`${step.placeholderFor} → ${step.label}`)
        }

        if (operation.action === 'replace') {
          const replaceTargets = takeTargetNodes(operation.target, operation.all)
          if (!replaceTargets) continue

          for (const node of replaceTargets) {
            replaceByName.push({ target: formatNodeTarget(node), step })
            applied.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editAppliedReplace, { node: describeGraphNodeForUser(node), label: step.label }))
          }
          continue
        }

        if (!tailIsExplicit(operation)) {
          // 자식인데 기준이 없으면 방금 만든 제어 노드를 부모로 삼는다.
          const inferredParentIndex = operation.branch ? lastControlInsertIndex : undefined
          // 자식도 아니고 기준도 없으면 Start 에서 이어지는 흐름의 끝에 잇는다.
          // 노드는 입력 엣지를 하나만 받으므로, 흐름 끝에 붙이는 것이 기존 구성을 건드리지 않는 방법이다.
          const flowTail = inferredParentIndex === undefined && !operation.branch ? flowTailName : ''

          insertAfter.push({
            after: flowTail,
            ...(inferredParentIndex !== undefined ? { afterCreatedIndex: inferredParentIndex } : {}),
            step,
            appendOnly: true,
            sourceHandle: operation.branch ? 'left' : 'right',
            targetHandle: 'left',
          })
          applied.push(
            flowTail
              ? appendedMessage(false, flowTail, step.label)
              : taskflowMessage(TASKFLOW_MESSAGE_KEY.editAppliedAppend, { label: step.label }),
          )
          createdLabels.push(step.label)
          if (step.taskType === TASK_TYPE.control) lastControlInsertIndex = insertAfter.length - 1
          if (operation.refId) insertIndexByRefId.set(operation.refId, insertAfter.length - 1)
          continue
        }

        // 별칭으로 지목한 경우가 가장 정확하다. 같은 이름을 여러 개 만들어도 섞이지 않는다.
        const refIndex = insertIndexByRefId.get(operation.after)
        if (refIndex !== undefined) {
          insertAfter.push({
            after: '',
            afterCreatedIndex: refIndex,
            step,
            appendOnly: true,
            sourceHandle: operation.branch ? 'left' : 'right',
            targetHandle: 'left',
          })
          const anchorLabel = insertAfter[refIndex]?.step.label ?? operation.after
          applied.push(appendedMessage(operation.branch, anchorLabel, step.label))
          createdLabels.push(step.label)
          if (step.taskType === TASK_TYPE.control) lastControlInsertIndex = insertAfter.length - 1
          if (operation.refId) insertIndexByRefId.set(operation.refId, insertAfter.length - 1)
          continue
        }

        // 같은 호출에서 방금 만든 노드를 기준으로 삼는 경우가 기존 캔버스 노드보다 우선한다.
        const pendingAnchor = findPendingLabel(operation.after, createdLabels, nodeTargetRules)
        if (pendingAnchor) {
          insertAfter.push({
            after: pendingAnchor,
            step,
            appendOnly: true,
            sourceHandle: operation.branch ? 'left' : 'right',
            targetHandle: 'left',
          })
          applied.push(appendedMessage(operation.branch, pendingAnchor, step.label))
          createdLabels.push(step.label)
          if (step.taskType === TASK_TYPE.control) lastControlInsertIndex = insertAfter.length - 1
          if (operation.refId) insertIndexByRefId.set(operation.refId, insertAfter.length - 1)
          continue
        }

        const anchorTargets = takeTargetNodes(operation.after, operation.all)
        if (!anchorTargets) continue

        // "모든 Parallel 에" 같은 요청은 기준 노드 수만큼 같은 삽입을 펼친다.
        for (const anchor of anchorTargets) {
          // "Parallel 에 X 추가" 는 자식이다. 우측/뒤/다음 이라고 말한 경우만 다음 순서로 잇는다.
          // 제어 노드는 자식으로 동작을 품는 노드라서, LLM 이 branch 를 빠뜨려도 여기서 바로잡는다.
          const branch =
            operation.branch ||
            (anchor.taskType === TASK_TYPE.control && !attachesToRightSide)

          // 동시 실행 제어 노드는 같은 Task 자식을 둘 이상 둘 수 없다(얼굴 2개를 동시에 보여줄 수 없다).
          if (branch && isConcurrentControlTask(anchor.taskName ?? '')) {
            const usedTasks = new Set(
              [
                ...readConcurrentChildTaskNames(graph, anchor.id),
                ...(concurrentChildTasksByAnchor.get(anchor.id) ?? []),
              ].map((name) => toMatchKey(name)),
            )

            if (usedTasks.has(toMatchKey(step.taskName))) {
              duplicateConcurrent.push(step.label)
              continue
            }

            concurrentChildTasksByAnchor.set(anchor.id, [
              ...(concurrentChildTasksByAnchor.get(anchor.id) ?? []),
              step.taskName,
            ])
          }

          insertAfter.push({
            after: formatNodeTarget(anchor),
            step,
            appendOnly: true,
            sourceHandle: branch ? 'left' : 'right',
            targetHandle: 'left',
          })
          applied.push(appendedMessage(branch, describeGraphNodeForUser(anchor), step.label))
        }
        createdLabels.push(step.label)
        if (step.taskType === TASK_TYPE.control) lastControlInsertIndex = insertAfter.length - 1
        if (operation.refId) insertIndexByRefId.set(operation.refId, insertAfter.length - 1)
      }

      if (ambiguous.length > 0 && applied.length === 0) {
        return {
          // 같은 이름을 여러 번 지목했으면 한 번만 되묻는다.
          clarification: taskflowMessage(TASKFLOW_MESSAGE_KEY.editAmbiguousClarification, {
            options: Array.from(new Set(ambiguous)).join(' / '),
          }),
          suggestions: [],
        }
      }

      if (applied.length === 0) {
        // 못 찾은 이름을 반드시 같이 보여 준다. notFound 문구에 {{names}} 자리가 없으면 missing 문구를 한 줄 더 붙인다.
        const missingNames = missing.filter(Boolean)
        const joined = missingNames.join(', ')
        const notFound = taskflowMessage(TASKFLOW_MESSAGE_KEY.editNotFound, { names: joined })
        const detail =
          joined && !notFound.includes(joined)
            ? taskflowMessage(TASKFLOW_MESSAGE_KEY.editMissing, { names: emphasize(missingNames) })
            : ''

        return {
          clarification: [notFound, detail].filter(Boolean).join('\n'),
          suggestions: [],
        }
      }

      ctx.log?.log(
        `[${TOOL_NAME}] applied=${applied.length} remove=${removeByName.length} replace=${replaceByName.length} insert=${insertAfter.length} missing=${missing.length} ambiguous=${ambiguous.length} placeholders=${placeholders.length}`,
      )

      const lines = [taskflowMessage(TASKFLOW_MESSAGE_KEY.editDone, { applied: emphasize(applied) })]
      if (placeholders.length > 0) {
        lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editPlaceholders, { pairs: emphasize(placeholders) }))
      }
      if (duplicateConcurrent.length > 0) {
        lines.push(
          taskflowMessage(TASKFLOW_MESSAGE_KEY.editDuplicateConcurrent, { names: emphasize(duplicateConcurrent) }),
        )
      }
      if (missing.length > 0) {
        lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editMissing, { names: emphasize(missing) }))
      }
      if (ambiguous.length > 0) {
        lines.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.editAmbiguous, { names: emphasize(ambiguous) }))
      }
      if (unknownProperties.length > 0) {
        lines.push(
          taskflowMessage(TASKFLOW_MESSAGE_KEY.editUnknownProperties, {
            names: emphasize(Array.from(new Set(unknownProperties))),
          }),
        )
      }

      const draft: Record<string, unknown> = { mode: 'edit' }
      if (removeByName.length > 0) draft.removeByName = removeByName
      if (replaceByName.length > 0) draft.replaceByName = replaceByName
      if (insertAfter.length > 0) draft.insertAfter = insertAfter
      if (updateProperties.length > 0) draft.updateProperties = updateProperties
      if (setRoles.length > 0) draft.setRoles = setRoles

      // 프론트가 이 draft 를 그대로 소비한다. 화면이 안 바뀌면 여기와 브라우저 로그를 대조한다.
      ctx.log?.log(`[${TOOL_NAME}] draft=${JSON.stringify(draft)}`)

      trace(traceReqId(ctx.context), '4-2.edit-draft', {
        remove: removeByName,
        replace: replaceByName.map((row) => `${row.target}->${row.step.label}`),
        insert: insertAfter.map((row) => `${row.after || `#${row.afterCreatedIndex ?? '-'}`}${row.sourceHandle === 'left' ? '↳' : '→'}${row.step.label}`),
      })

      return {
        ...buildApplyDraftAction(draft, ctx, TASKFLOW_TOOL_KEY.edit),
        assistantText: lines.filter(Boolean).join('\n'),
      }
    },
  }
}
