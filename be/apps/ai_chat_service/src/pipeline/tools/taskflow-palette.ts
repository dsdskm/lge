import type { ToolContext } from '../tool.type'
import { getPropertyTmsStore, type TaskSemantics } from '../../features/taskflow/service/property-tms-store.service'
import { taskflowMessage, TASKFLOW_MESSAGE_KEY } from './taskflow-message'

export { TASKFLOW_CANVAS_SCREEN_KEY } from './taskflow-message'

/** 프론트가 보낸 현재 팔레트의 task-content 쌍. */
export type TaskContentRef = {
  taskId: number
  taskName: string
  contentName: string
  contentId: number
}

/** 캔버스에 이미 놓여 있는 노드. id 는 프론트가 만든 값이라 서버는 이름으로만 지목한다. */
export type GraphNodeRef = {
  id: string
  label: string
  taskName?: string
  contentName?: string
  taskType?: string
  /** 이름이 겹치는 노드에만 프론트가 붙이는 화면 순번. 유일한 이름은 없다. */
  ordinal?: number
}

/** 프론트 팔레트가 알려 준 Task 속성 스키마. Delay 의 delay_msec 처럼 값으로 지정할 수 있는 키들. */
export type TaskPropertyRef = {
  taskName: string
  key: string
  type: string
  description: string
}

export type CurrentGraph = {
  nodes: GraphNodeRef[]
  edges: Array<{ source: string; target: string; branch: boolean }>
}

export function toMatchKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function readTaskflowContext(context: unknown): Record<string, unknown> | null {
  if (!context || typeof context !== 'object') return null

  const taskflow = (context as Record<string, unknown>).taskflow
  if (!taskflow || typeof taskflow !== 'object') return null
  return taskflow as Record<string, unknown>
}

export function readTaskContents(ctx: ToolContext): TaskContentRef[] {
  return readTaskContentsFromContext(ctx.context)
}

export function readTaskContentsFromContext(context: unknown): TaskContentRef[] {
  const rows = readTaskflowContext(context)?.taskContents
  if (!Array.isArray(rows)) return []

  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => ({
      taskId: Number(row.taskId),
      taskName: String(row.taskName || '').trim(),
      contentName: String(row.contentName || '').trim(),
      contentId: Number(row.contentId),
    }))
    .filter(
      (row) =>
        row.taskName.length > 0 &&
        row.contentName.length > 0 &&
        Number.isFinite(row.taskId) &&
        Number.isFinite(row.contentId),
    )
}

/** property_tms.compose_hint.properties 에 적어 둔 속성 스키마를 읽는다. 프론트 propertySchema 와 같은 키를 쓴다. */
export function readTaskPropertySchema(semantics: TaskSemantics | undefined): TaskPropertyRef[] {
  const holder = semantics?.composeHint?.properties
  if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return []

  return Object.entries(holder as Record<string, unknown>)
    .map(([key, def]) => {
      const row = def && typeof def === 'object' ? (def as Record<string, unknown>) : {}
      return {
        taskName: semantics?.taskName ?? '',
        key: String(key).trim(),
        type: String(row.type ?? '').trim(),
        description: String(row.description ?? '').trim(),
      }
    })
    .filter((row) => row.key.length > 0)
}

/** LLM 이 읽을 속성 목록. 값을 지정할 수 있는 키를 Task 별로 한 줄씩 적는다. */
export function describeTaskProperties(tasks: TaskSemantics[]): string {
  return tasks
    .map((task) => {
      const rows = readTaskPropertySchema(task)
      if (rows.length === 0) return ''
      const keys = rows
        .map((row) => `${row.key}${row.type ? `:${row.type}` : ''}${row.description ? `(${row.description})` : ''}`)
        .join(', ')
      return `- ${task.taskName}: ${keys}`
    })
    .filter(Boolean)
    .join('\n')
}

/** 스키마 타입에 맞춰 값을 바꾼다. LLM 이 숫자를 문자열로 보내도 프론트가 그대로 쓸 수 있게 한다. */
export function coercePropertyValue(value: unknown, type: string): unknown {
  const normalizedType = String(type ?? '').trim().toLowerCase()

  if (normalizedType === 'number' || normalizedType === 'content_reference') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : value
  }
  if (normalizedType === 'boolean') {
    if (typeof value === 'boolean') return value
    const text = String(value ?? '').trim().toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
    return value
  }
  return value
}

/** LLM 이 보낸 속성 이름을 스키마의 실제 키로 맞춘다. 스키마에 없는 키는 버리고 따로 알린다. */
export function resolveProperties(
  semantics: TaskSemantics | undefined,
  requested: Record<string, unknown>,
): { properties: Record<string, unknown>; unknownKeys: string[] } {
  const rows = readTaskPropertySchema(semantics)
  const properties: Record<string, unknown> = {}
  const unknownKeys: string[] = []

  for (const [key, value] of Object.entries(requested ?? {})) {
    const matched = rows.find((row) => toMatchKey(row.key) === toMatchKey(key))
    if (!matched) {
      unknownKeys.push(key)
      continue
    }
    properties[matched.key] = coercePropertyValue(value, matched.type)
  }

  return { properties, unknownKeys }
}

export function readCurrentGraph(ctx: ToolContext): CurrentGraph {
  return readCurrentGraphFromContext(ctx.context)
}

/** 의도 분류는 ToolContext 를 만들기 전에 돌아서 요청 context 를 직접 받는다. */
export function readCurrentGraphFromContext(context: unknown): CurrentGraph {
  const graph = readTaskflowContext(context)?.currentGraph
  if (!graph || typeof graph !== 'object') return { nodes: [], edges: [] }

  const row = graph as Record<string, unknown>
  const nodes = Array.isArray(row.nodes) ? row.nodes : []
  const edges = Array.isArray(row.edges) ? row.edges : []

  return {
    nodes: nodes
      .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === 'object')
      .map((node) => ({
        id: String(node.id || '').trim(),
        label: String(node.label || '').trim(),
        taskName: String(node.taskName || '').trim() || undefined,
        contentName: String(node.contentName || '').trim() || undefined,
        taskType: String(node.taskType || '').trim() || undefined,
        ordinal: Number.isInteger(Number(node.ordinal)) && Number(node.ordinal) > 0 ? Number(node.ordinal) : undefined,
      }))
      .filter((node) => node.id.length > 0 && node.label.length > 0),
    edges: edges
      .filter((edge): edge is Record<string, unknown> => Boolean(edge) && typeof edge === 'object')
      .map((edge) => ({
        source: String(edge.source || '').trim(),
        target: String(edge.target || '').trim(),
        branch: Boolean(edge.branch),
      }))
      .filter((edge) => edge.source.length > 0 && edge.target.length > 0),
  }
}

/**
 * Task 별 "호칭 접미어". 사람이 노드를 부를 때 이름 뒤에 붙이는 말이다.
 *   MoveTo -> 장소/POI/위치, PlayMotion -> 모션, PlayFace -> 얼굴/표정, Tts -> 발화/음성 ...
 * 값은 property_tms.compose_hint.nameSuffixes 에서 온다. 행이 없으면 접미어 처리를 하지 않는다.
 */
export function readNameSuffixPhrases(taskName: string): string[] {
  const semantics = getPropertyTmsStore()?.get(String(taskName ?? '').trim())
  const raw = semantics?.composeHint?.nameSuffixes

  if (!Array.isArray(raw)) return []
  return Array.from(
    new Set(
      raw
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  )
}

/** 이름 뒤에 붙은 호칭 접미어를 떼어 낸 형태. "도슨트 환영 장소" -> "도슨트 환영" */
function stripNameSuffix(value: string, suffixes: string[]): string {
  let result = String(value ?? '').trim()

  for (const suffix of [...suffixes].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`\\s*${escapeRegExp(suffix)}\\s*$`, 'i')
    if (pattern.test(result)) {
      result = result.replace(pattern, '').trim()
      break
    }
  }

  return result
}

/**
 * 콘텐츠 이름을 문장과 맞춰 볼 후보 키 목록.
 *
 * - 이름 전체(괄호까지가 이름이다)
 * - 괄호 코드를 떼어 낸 형태: "도슨트 대기(D1)" 를 "도슨트 대기 장소" 라고 부르는 경우
 * - 호칭 접미어를 떼어 낸 형태: 이름이 "도슨트 환영 장소" 인데 "도슨트 환영으로 이동" 이라고 부르는 경우
 */
export function buildContentMatchKeys(contentName: string, suffixes: string[] = []): string[] {
  const raw = String(contentName ?? '').trim()
  const withoutBrackets = raw.replace(/[([{<][^)\]}>]*[)\]}>]/g, ' ').trim()

  const variants = [raw, withoutBrackets, stripNameSuffix(raw, suffixes), stripNameSuffix(withoutBrackets, suffixes)]

  return Array.from(new Set(variants.map((value) => toMatchKey(value)))).filter((key) => key.length >= 2)
}

/** "타임아웃" 처럼 사람이 부르는 이름을 Task 이름으로 바꾼다. 별칭은 property_tms.trigger_phrases 에 있다. */
export function resolveTaskAlias(name: string): string {
  const key = toMatchKey(name)
  if (!key) return String(name ?? '').trim()

  const store = getPropertyTmsStore()
  if (!store) return String(name ?? '').trim()

  const direct = store.get(String(name ?? '').trim())
  if (direct) return direct.taskName

  const matched = store
    .list()
    .find((task) => task.triggerPhrases.some((phrase) => toMatchKey(phrase) === key))

  return matched?.taskName ?? String(name ?? '').trim()
}

/** 낮을수록 좋은 매칭. 요청어가 콘텐츠명보다 길 수도 있어 양방향으로 본다. */
function scoreContentMatch(requestKey: string, contentKey: string): number | null {
  if (!contentKey) return null
  if (contentKey === requestKey) return 0
  if (contentKey.startsWith(requestKey) || requestKey.startsWith(contentKey)) return 1
  if (contentKey.includes(requestKey)) return 2
  if (requestKey.includes(contentKey)) return 3
  return null
}

function scoreByToken(requestName: string, contentKey: string): number | null {
  const tokens = requestName.split(/\s+/).filter((token) => token.length >= 2)
  const hit = tokens.some((token) => toMatchKey(token) === contentKey)
  return hit ? 4 : null
}

/** 이름이 정확히 같은 것 우선, 없으면 길이 차가 가장 작은 후보를 고른다. */
export function findContentRef(
  contentName: string,
  taskName: string,
  contents: TaskContentRef[],
): TaskContentRef | undefined {
  const key = toMatchKey(contentName)
  if (!key) return undefined

  const taskKey = toMatchKey(taskName)
  const scoped = taskKey ? contents.filter((row) => toMatchKey(row.taskName) === taskKey) : contents
  const pool = scoped.length > 0 ? scoped : contents

  let best: TaskContentRef | undefined
  let bestScore = Number.MAX_SAFE_INTEGER
  let bestGap = Number.MAX_SAFE_INTEGER

  // 요청어에서도 호칭 접미어를 떼어 본다. "도슨트 대기 장소" 로 불러도 이름이 "도슨트 대기(D1)" 인 경우가 있다.
  const requestKeys = Array.from(
    new Set([
      key,
      ...(taskName ? buildContentMatchKeys(contentName, readNameSuffixPhrases(taskName)) : []),
    ]),
  ).filter(Boolean)

  for (const row of pool) {
    const fullKey = toMatchKey(row.contentName)
    // "1" 처럼 한 글자 이름은 아무 요청에나 걸려 엉뚱한 노드가 붙는다. 정확히 같을 때만 인정한다.
    if (fullKey.length < 2 && fullKey !== key) continue

    // 이름 쪽도 괄호/접미어를 떼어 낸 형태까지 함께 본다.
    const contentKeys = Array.from(
      new Set([fullKey, ...buildContentMatchKeys(row.contentName, readNameSuffixPhrases(row.taskName))]),
    )

    for (const contentKey of contentKeys) {
      for (const requestKey of requestKeys) {
        const direct = scoreContentMatch(requestKey, contentKey)
        const score = direct === null ? scoreByToken(contentName, contentKey) : direct
        if (score === null) continue

        const gap = Math.abs(contentKey.length - requestKey.length)
        if (score > bestScore) continue
        if (score === bestScore && gap >= bestGap) continue

        best = row
        bestScore = score
        bestGap = gap
      }
    }
  }

  return best
}

export function findSuggestions(requested: string, tasks: TaskSemantics[]): string[] {
  const key = String(requested).trim().toLowerCase()
  if (!key) return []

  const matched = tasks.filter((task) => {
    if (task.taskName.toLowerCase().includes(key)) return true
    return task.triggerPhrases.some((phrase) => phrase.toLowerCase().includes(key) || key.includes(phrase.toLowerCase()))
  })

  return matched.slice(0, 3).map((task) => task.taskName)
}

/**
 * "두번째 Love" 처럼 말로 센 순번을 읽기 위한 규칙. 표기는 코드에 두지 않고
 * taskflow rule(nodeTargetOrdinalWords / nodeTargetOrdinalSuffixPhrases / nodeTargetNounPhrases)에서 온다.
 * 규칙이 없으면 "#N" 만 인식하던 이전 동작이 그대로 유지된다.
 */
export type NodeTargetRules = {
  ordinalWords: Record<string, number>
  ordinalSuffixPhrases: string[]
  nounPhrases: string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function alternation(values: string[]): string {
  return values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
}

/** 이름 뒤에 붙는 군더더기를 규칙대로 떼어낸다. "두번째 Parallel 노드" -> "Parallel" */
function stripNounPhrase(value: string, rules?: NodeTargetRules): string {
  const nouns = alternation(rules?.nounPhrases ?? [])
  const trimmed = value.trim()
  if (!nouns) return trimmed
  return trimmed.replace(new RegExp(`\\s*(?:${nouns})$`, 'i'), '').trim()
}

function toOrdinal(rules: NodeTargetRules, digits?: string, word?: string): number | null {
  const value = digits ? Number(digits) : word ? rules.ordinalWords[word] : NaN
  return Number.isInteger(value) && value > 0 ? value : null
}

/** 규칙이 다 채워졌을 때만 순번 문구용 정규식을 만든다. */
function buildOrdinalPatterns(rules?: NodeTargetRules): { prefix: RegExp; suffix: RegExp } | null {
  if (!rules) return null

  const words = alternation(Object.keys(rules.ordinalWords))
  const suffixes = alternation(rules.ordinalSuffixPhrases)
  if (!words || !suffixes) return null

  const counter = `(?:(\\d+)|(${words}))\\s*(?:${suffixes})`
  return {
    prefix: new RegExp(`^${counter}\\s*(.+)$`, 'i'),
    suffix: new RegExp(`^(.+?)\\s*${counter}$`, 'i'),
  }
}

/** "Parallel #2" 처럼 번호가 붙은 지목을 이름과 번호로 가른다. 프론트 parseNodeTargetName 과 같은 규칙이다. */
export function parseNodeTarget(value: unknown, rules?: NodeTargetRules): { name: string; ordinal: number | null } {
  const raw = String(value ?? '').trim()
  const matched = raw.match(/^(.*\S)\s*#\s*(\d+)$/)
  if (matched) {
    const ordinal = Number(matched[2])
    if (Number.isInteger(ordinal) && ordinal > 0) return { name: matched[1].trim(), ordinal }
    return { name: raw, ordinal: null }
  }

  const patterns = buildOrdinalPatterns(rules)
  if (patterns && rules) {
    const prefix = raw.match(patterns.prefix)
    if (prefix) {
      const ordinal = toOrdinal(rules, prefix[1], prefix[2])
      const name = stripNounPhrase(prefix[3], rules)
      if (ordinal !== null && name.length > 0) return { name, ordinal }
    }

    const suffix = raw.match(patterns.suffix)
    if (suffix) {
      const ordinal = toOrdinal(rules, suffix[2], suffix[3])
      const name = stripNounPhrase(suffix[1], rules)
      if (ordinal !== null && name.length > 0) return { name, ordinal }
    }
  }

  const bare = stripNounPhrase(raw, rules)
  return { name: bare.length > 0 ? bare : raw, ordinal: null }
}

/** 프론트가 draft 를 적용할 때 쓰는 지목 문자열. 번호가 있으면 반드시 붙여 한 노드로 좁힌다. */
export function formatNodeTarget(node: GraphNodeRef): string {
  return node.ordinal ? `${node.label} #${node.ordinal}` : node.label
}

/** 이름이 같은 노드를 화면 번호 순서대로 모두 돌려준다. 번호를 지정하면 그 한 개만 남는다. */
export function findGraphNodes(name: string, graph: CurrentGraph, rules?: NodeTargetRules): GraphNodeRef[] {
  const { name: baseName, ordinal } = parseNodeTarget(name, rules)

  const matchByName = (needle: string): GraphNodeRef[] => {
    const key = toMatchKey(needle)
    if (!key) return []

    // 조회 출력에 쓰는 표기(DB node.label 템플릿)도 후보에 넣는다. LLM 이 그 문자열을 그대로 지목해 온다.
    const names = (node: GraphNodeRef) => [
      node.label,
      node.taskName,
      node.contentName,
      formatNodeLabel(node.taskName, node.contentName),
    ]

    const exact = graph.nodes.filter((node) => names(node).some((value) => toMatchKey(String(value ?? '')) === key))
    if (exact.length > 0) return exact

    return graph.nodes.filter((node) =>
      names(node).some((value) => {
        const target = toMatchKey(String(value ?? ''))
        return target.length > 0 && (target.includes(key) || key.includes(target))
      }),
    )
  }

  const bySortOrder = (rows: GraphNodeRef[]) =>
    rows.slice().sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0))

  // "타임아웃 노드" 처럼 별칭으로 지목한 경우 Task 이름으로 바꿔 한 번 더 찾는다.
  const matchWithAlias = (needle: string): GraphNodeRef[] => {
    const direct = matchByName(needle)
    if (direct.length > 0) return direct

    const alias = resolveTaskAlias(needle)
    return toMatchKey(alias) === toMatchKey(needle) ? [] : matchByName(alias)
  }

  if (ordinal === null) return bySortOrder(matchWithAlias(baseName))

  const candidates = bySortOrder(matchWithAlias(baseName))
  const numbered = candidates.filter((node) => Number(node.ordinal ?? 0) === ordinal)
  if (numbered.length > 0) return numbered

  // 프론트가 순번 배지를 안 붙인 경우엔 화면 순서 그대로 N 번째를 고른다.
  if (candidates.length > 1 && ordinal <= candidates.length) return [candidates[ordinal - 1]]

  // "Room #3" 처럼 이름 자체에 # 이 들어간 콘텐츠일 수 있다.
  return bySortOrder(matchByName(String(name ?? '').trim()))
}

/** 같은 이름이 여러 개면 프론트와 같이 가장 나중에 추가된 노드를 고른다. */
export function findGraphNode(name: string, graph: CurrentGraph, rules?: NodeTargetRules): GraphNodeRef | undefined {
  const matched = findGraphNodes(name, graph, rules)
  return matched[matched.length - 1]
}

export function describeGraphNode(node: GraphNodeRef): string {
  // 표기는 DB node.label 템플릿 하나로 통일한다. 코드가 다른 순서로 적으면 LLM 이 되돌려준 이름을 못 찾는다.
  const base = formatNodeLabel(node.taskName, node.contentName) || node.label
  return node.ordinal ? `${base} #${node.ordinal}` : base
}

/** 채팅 사용자에게 보이는 문구용. 화면에 번호 배지가 없으니 "#N" 을 붙이지 않는다. */
export function describeGraphNodeForUser(node: GraphNodeRef): string {
  return formatNodeLabel(node.taskName, node.contentName) || node.label
}

/** 노드를 사람이 읽는 한 줄로 옮긴다. 표기 순서는 prompt 의 node.label 템플릿이 정한다. */
export function formatNodeLabel(taskName?: string, contentName?: string): string {
  if (!taskName || !contentName) return ''

  return taskflowMessage(TASKFLOW_MESSAGE_KEY.nodeLabel, { taskName, contentName })
}

/** LLM 이 읽을 현재 캔버스 구조. 실행 흐름과 자식 분기를 구분해 적는다. */
export function describeGraph(graph: CurrentGraph): string {
  if (graph.nodes.length === 0) return taskflowMessage(TASKFLOW_MESSAGE_KEY.graphEmpty)

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))

  return graph.nodes
    .map((node) => {
      const outgoing = graph.edges.filter((edge) => edge.source === node.id)
      const next = outgoing
        .filter((edge) => !edge.branch)
        .map((edge) => byId.get(edge.target))
        .filter((row): row is GraphNodeRef => Boolean(row))
      const children = outgoing
        .filter((edge) => edge.branch)
        .map((edge) => byId.get(edge.target))
        .filter((row): row is GraphNodeRef => Boolean(row))

      const parts = [`- ${describeGraphNode(node)}`]
      if (children.length > 0) {
        parts.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.graphChildren, { nodes: children.map(describeGraphNode).join(', ') }))
      }
      if (next.length > 0) {
        parts.push(taskflowMessage(TASKFLOW_MESSAGE_KEY.graphNext, { nodes: next.map(describeGraphNode).join(', ') }))
      }
      return parts.join(' | ')
    })
    .join('\n')
}
