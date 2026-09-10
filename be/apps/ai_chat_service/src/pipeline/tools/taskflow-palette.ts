import type { ToolContext } from '../tool.type'
import { getPropertyTmsStore, TASK_TYPE, type TaskSemantics } from '../../features/taskflow/service/property-tms-store.service'
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
  /** "3초" -> 3000 처럼 사용자 문장의 숫자를 값으로 바꿀 때 쓰는 단위 배수.
   * property_tms.compose_hint.properties.<key>.unitPhrases 에서 온다. 코드에는 단위 표현을 두지 않는다.
   */
  unitPhrases: Array<{ phrase: string; multiplier: number }>
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
      const units = row.unitPhrases && typeof row.unitPhrases === 'object' && !Array.isArray(row.unitPhrases)
        ? Object.entries(row.unitPhrases as Record<string, unknown>)
            .map(([phrase, multiplier]) => ({ phrase: String(phrase).trim(), multiplier: Number(multiplier) }))
            .filter((unit) => unit.phrase.length > 0 && Number.isFinite(unit.multiplier))
            .sort((a, b) => b.phrase.length - a.phrase.length)
        : []

      return {
        taskName: semantics?.taskName ?? '',
        key: String(key).trim(),
        type: String(row.type ?? '').trim(),
        description: String(row.description ?? '').trim(),
        unitPhrases: units,
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

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 사용자 문장에서 "3초" / "3회" 처럼 단위가 붙은 숫자를 찾아, LLM 이 빠뜨린 속성 값을 채운다.
 * 단위 표현과 배수는 property_tms.compose_hint.properties.<key>.unitPhrases 가 정한다.
 * 후보가 여러 개면(값이 서로 다르면) 무엇을 뜻하는지 알 수 없으므로 채우지 않는다.
 */
export function fillPropertiesFromMessage(
  semantics: TaskSemantics | undefined,
  properties: Record<string, unknown>,
  message: string,
): { properties: Record<string, unknown>; filledKeys: string[] } {
  const text = String(message ?? '')
  const rows = readTaskPropertySchema(semantics)
  if (!text.trim() || rows.length === 0) return { properties, filledKeys: [] }

  const next = { ...properties }
  const filledKeys: string[] = []

  for (const row of rows) {
    if (next[row.key] !== undefined || row.unitPhrases.length === 0) continue

    // 긴 표현이 먼저 오게 해서 "500밀리초" 가 "초" 로 잡히지 않게 한다(정규식 대안은 앞에서부터 맞춘다).
    const alternation = row.unitPhrases.map((unit) => escapeForRegExp(unit.phrase)).join('|')
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${alternation})`, 'gi')

    const values = new Set<number>()
    for (const match of text.matchAll(pattern)) {
      const unit = row.unitPhrases.find((candidate) => candidate.phrase.toLowerCase() === match[2].toLowerCase())
      if (!unit) continue
      values.add(Number(match[1]) * unit.multiplier)
    }

    if (values.size !== 1) continue
    next[row.key] = coercePropertyValue([...values][0], row.type)
    filledKeys.push(row.key)
  }

  return { properties: next, filledKeys }
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
/** 접미어를 떼어 만든 키를 그대로 믿으면 안 되는 최소 길이.
 * "이동 음악" 에서 "음악" 을 떼면 "이동" 이 되어 아무 문장의 '이동' 에나 걸린다.
 */
const STRIPPED_KEY_SAFE_LENGTH = 4

export type ContentMatchKey = {
  key: string
  /** 호칭 접미어를 떼어 만든 키인지. 짧으면 흔한 낱말과 겹쳐 오탐이 난다. */
  stripped: boolean
}

/** 콘텐츠 이름의 비교 후보. 이름 전체 / 괄호 제거 / 접미어 제거 형태를 모두 만든다. */
export function buildContentMatchEntries(contentName: string, suffixes: string[] = []): ContentMatchKey[] {
  const raw = String(contentName ?? '').trim()
  const withoutBrackets = raw.replace(/[([{<][^)\]}>]*[)\]}>]/g, ' ').trim()

  // 괄호/접미어를 떼어 만든 형태는 이름 그대로가 아니다.
  // "이동(g)" 의 "이동" 처럼 떼고 나면 흔한 낱말이 되는 경우가 있어 따로 표시해 둔다.
  const variants: ContentMatchKey[] = [
    { key: toMatchKey(raw), stripped: false },
    { key: toMatchKey(withoutBrackets), stripped: toMatchKey(withoutBrackets) !== toMatchKey(raw) },
    { key: toMatchKey(stripNameSuffix(raw, suffixes)), stripped: true },
    { key: toMatchKey(stripNameSuffix(withoutBrackets, suffixes)), stripped: true },
  ]

  const byKey = new Map<string, ContentMatchKey>()
  for (const entry of variants) {
    if (entry.key.length < 2) continue
    const previous = byKey.get(entry.key)
    // 같은 키가 양쪽에서 나오면 이름 그대로인 쪽으로 본다.
    if (!previous || (previous.stripped && !entry.stripped)) byKey.set(entry.key, entry)
  }

  return [...byKey.values()]
}

export function buildContentMatchKeys(contentName: string, suffixes: string[] = []): string[] {
  return buildContentMatchEntries(contentName, suffixes).map((entry) => entry.key)
}

/** 그 Task 를 부르는 말(trigger_phrases + 호칭 접미어)이 요청 안에 있는지.
 * 이름만으로는 동작인지 대상인지 가릴 수 없는 경우("이동")를 가리는 데 쓴다.
 */
export function requestCallsTask(requestText: string, taskName: string): boolean {
  const requestKey = toMatchKey(requestText)
  if (!requestKey) return false

  const semantics = getPropertyTmsStore()?.get(taskName)
  const words = [...(semantics?.triggerPhrases ?? []), ...readNameSuffixPhrases(taskName)]

  return words.some((word) => {
    const wordKey = toMatchKey(word)
    return wordKey.length >= 2 && requestKey.includes(wordKey)
  })
}

/** 콘텐츠 이름이 다른 Task 를 부르는 말과 같은지.
 * PlaySound 콘텐츠 "이동" 처럼 이름 자체가 다른 Task 의 동작 표현(MoveTo 의 "이동")인 경우다.
 */
function nameLooksLikeOtherTaskWord(contentName: string, taskName: string): boolean {
  // 괄호/접미어를 뗀 형태까지 본다. "이동(g)" 는 떼면 MoveTo 의 "이동" 과 같아진다.
  const nameKeys = buildContentMatchEntries(contentName, readNameSuffixPhrases(taskName)).map((entry) => entry.key)
  if (nameKeys.length === 0) return false

  const ownKey = toMatchKey(taskName)
  return (getPropertyTmsStore()?.list() ?? []).some((task) => {
    if (toMatchKey(task.taskName) === ownKey) return false
    const words = [task.taskName, ...(task.triggerPhrases ?? []), ...readNameSuffixPhrases(task.taskName)]
    return words.some((word) => nameKeys.includes(toMatchKey(word)))
  })
}

/** 이 비교 키를 요청에 써도 되는지.
 *  - 접미어를 떼어 만든 짧은 키("이동 음악" -> "이동")
 *  - 이름 자체가 다른 Task 의 동작 표현인 콘텐츠(PlaySound "이동")
 * 둘 다 흔한 낱말에 걸려 엉뚱한 노드를 만든다. 요청이 그 Task 를 부르고 있을 때만 인정한다.
 */
export function canUseStrippedKey(
  entry: ContentMatchKey,
  requestText: string,
  taskName: string,
  contentName = '',
): boolean {
  if (nameLooksLikeOtherTaskWord(contentName, taskName) && !requestCallsTask(requestText, taskName)) return false
  if (!entry.stripped) return true
  if (entry.key.length >= STRIPPED_KEY_SAFE_LENGTH) return true

  return requestCallsTask(requestText, taskName)
}

/** "타임아웃" 처럼 사람이 부르는 이름을 Task 이름으로 바꾼다. 별칭은 property_tms.trigger_phrases 에 있다. */
/** 오타 허용 거리(Damerau-Levenshtein). "puase" 와 "pause" 는 1 이다. */
export function nameDistance(a: string, b: string): number {
  const left = toMatchKey(a)
  const right = toMatchKey(b)
  if (!left || !right) return Number.MAX_SAFE_INTEGER
  if (left === right) return 0

  const rows = left.length + 1
  const cols = right.length + 1
  const table: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)),
  )

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      table[row][col] = Math.min(table[row - 1][col] + 1, table[row][col - 1] + 1, table[row - 1][col - 1] + cost)

      // 자리 바뀜(pause -> puase)은 한 번의 실수로 본다.
      if (row > 1 && col > 1 && left[row - 1] === right[col - 2] && left[row - 2] === right[col - 1]) {
        table[row][col] = Math.min(table[row][col], table[row - 2][col - 2] + 1)
      }
    }
  }

  return table[rows - 1][cols - 1]
}

/** 이름 길이에 비례한 오타 허용치. 짧은 이름에서 엉뚱한 노드가 잡히지 않게 좁게 잡는다. */
function typoBudget(name: string): number {
  const length = toMatchKey(name).length
  if (length < 4) return 0
  if (length < 8) return 1
  return 2
}

/** 오타를 감안해 가장 가까운 Task 이름. 후보가 동점이면 매칭하지 않는다. */
export function findClosestTaskName(name: string): string | undefined {
  const budget = typoBudget(name)
  if (budget === 0) return undefined

  const scored = (getPropertyTmsStore()?.list() ?? [])
    .flatMap((task) => [task.taskName, ...(task.triggerPhrases ?? [])].map((candidate) => ({ task: task.taskName, candidate })))
    .map((row) => ({ ...row, distance: nameDistance(name, row.candidate) }))
    .filter((row) => row.distance <= budget)
    .sort((a, b) => a.distance - b.distance)

  const best = scored[0]
  if (!best) return undefined
  if (scored.some((row) => row.distance === best.distance && row.task !== best.task)) return undefined

  return best.task
}

/** 오타를 감안해 가장 가까운 콘텐츠. taskName 을 알면 그 Task 안에서만 본다. */
export function findClosestContent(
  name: string,
  taskName: string,
  contents: TaskContentRef[],
): TaskContentRef | undefined {
  const budget = typoBudget(name)
  if (budget === 0) return undefined

  const taskKey = toMatchKey(taskName)
  const pool = taskKey ? contents.filter((row) => toMatchKey(row.taskName) === taskKey) : contents

  const scored = pool
    .map((row) => ({ row, distance: nameDistance(name, row.contentName) }))
    .filter((row) => row.distance <= budget)
    .sort((a, b) => a.distance - b.distance)

  const best = scored[0]
  if (!best) return undefined
  if (scored.some((row) => row.distance === best.distance && row.row.contentId !== best.row.contentId)) return undefined

  return best.row
}

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

  // 오타 보정은 여기서 하지 않는다. 콘텐츠 이름("Love")이 Task 표현("move")과 한 글자 차이일 수 있어
  // 팔레트를 먼저 본 뒤에 findClosestTaskName 을 쓰는 쪽이 안전하다.
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

  for (const row of pool) {
    // 요청어에서도 호칭 접미어를 떼어 본다. "도슨트 대기 장소" 로 불러도 이름이 "도슨트 대기(D1)" 인 경우가 있다.
    // Task 를 모르고 부른 경우("인트로 음성")에는 비교 대상 행의 Task 접미어를 쓴다.
    const requestKeys = Array.from(
      new Set([key, ...buildContentMatchKeys(contentName, readNameSuffixPhrases(taskName || row.taskName))]),
    ).filter(Boolean)

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

/** "인트로 tts" / "인트로 음성" 처럼 Task 를 부르는 말이 섞인 이름을 실제 콘텐츠로 맞춘다.
 *
 * 먼저 이름 그대로 찾고, 못 찾으면 Task 이름·trigger_phrases·호칭 접미어(property_tms)를 떼어 낸 뒤
 * 그 Task 안에서 다시 찾는다. 긴 표현부터 떼어 보므로 "인트로 음성" 은 Tts 의 "1.인트로" 로 간다.
 * 떼어 낼 표현은 전부 DB 에서 온다.
 */
export function resolveContentByLooseName(
  name: string,
  contents: TaskContentRef[],
): TaskContentRef | undefined {
  const raw = String(name ?? '').trim()
  if (!raw || contents.length === 0) return undefined

  const direct = findContentRef(raw, '', contents)
  if (direct) return direct

  const nameKey = toMatchKey(raw)
  const candidates = (getPropertyTmsStore()?.list() ?? []).flatMap((task) =>
    [task.taskName, ...(task.triggerPhrases ?? []), ...readNameSuffixPhrases(task.taskName)]
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length >= 2 && nameKey.includes(toMatchKey(value)))
      .map((phrase) => ({ taskName: task.taskName, phrase })),
  )

  for (const candidate of candidates.sort((a, b) => b.phrase.length - a.phrase.length)) {
    const stripped = raw
      .replace(new RegExp(candidate.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!stripped || stripped === raw) continue

    const matched =
      findContentRef(stripped, candidate.taskName, contents) ??
      findClosestContent(stripped, candidate.taskName, contents)
    if (matched) return matched
  }

  return findClosestContent(raw, '', contents) ?? matchContentInText(raw, '', contents)
}

/** 문장에서 콘텐츠 이름 후보를 뽑는다.
 *
 * 군더더기(rule 의 clauseNoisePhrases 등)를 떼고 남은 말을 토큰으로 자른 뒤,
 * 이어지는 토큰 묶음(n-gram)을 긴 것부터 후보로 내놓는다. "대기 장소로 좀 빨리 가줘" 처럼
 * 이름 앞뒤에 말이 더 붙어도 이름만 잘라 볼 수 있다.
 * 어떤 말을 떼는지는 전부 DB 에서 오고, 자르는 기준(공백·문장 기호)만 코드에 둔다.
 */
export function extractNameCandidates(text: string, noisePhrases: string[] = []): string[] {
  const noise = [...noisePhrases]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  // 군더더기는 토큰 끝(조사 자리)이나 토큰 전체일 때만 뗀다.
  // 토큰 안쪽까지 지우면 이름이 깨진다("인트로" 에서 "로" 를 떼면 "인트" 가 된다).
  const trimNoise = (token: string): string => {
    let current = token
    let changed = true
    while (changed) {
      changed = false
      for (const phrase of noise) {
        if (current.length > phrase.length && current.toLowerCase().endsWith(phrase.toLowerCase())) {
          current = current.slice(0, current.length - phrase.length)
          changed = true
        }
      }
    }
    return current
  }

  const tokens = String(text ?? '')
    .split(/[\s,;:!?~()[\]{}<>"'`]+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim())
    .filter(Boolean)
    .filter((token) => !noise.some((phrase) => phrase.toLowerCase() === token.toLowerCase()))
  if (tokens.length === 0) return []

  // 조사를 뗀 형태와 떼지 않은 형태를 모두 후보로 낸다.
  // 이름이 조사처럼 끝나는 경우("인트로")가 있어 어느 한쪽만 쓰면 놓친다.
  const variants = [tokens, tokens.map(trimNoise).filter(Boolean)]
  const candidates: string[] = []

  for (const list of variants) {
    const maxWindow = Math.min(list.length, 6)
    for (let size = maxWindow; size >= 1; size -= 1) {
      for (let start = 0; start + size <= list.length; start += 1) {
        candidates.push(list.slice(start, start + size).join(' '))
      }
    }
  }

  return Array.from(new Set(candidates))
    .filter((candidate) => toMatchKey(candidate).length >= 2)
    .sort((a, b) => toMatchKey(b).length - toMatchKey(a).length)
}

/** 문장에서 뽑은 후보들로 콘텐츠를 찾는다. 긴 후보(더 구체적인 이름)부터 보고, 오타까지 감안한다.
 * taskName 을 알면 그 Task 안에서만 본다.
 */
export function matchContentInText(
  text: string,
  taskName: string,
  contents: TaskContentRef[],
  noisePhrases: string[] = [],
): TaskContentRef | undefined {
  if (contents.length === 0) return undefined

  for (const candidate of extractNameCandidates(text, noisePhrases)) {
    const matched =
      matchContentStrict(candidate, taskName, contents, text) ?? findClosestContent(candidate, taskName, contents)
    if (matched) return matched
  }

  return undefined
}

/** 그 Task 를 부르는 말(이름·trigger·호칭 접미어)인지. 이름 후보에서 걸러내는 데 쓴다. */
function isTaskWordKey(key: string, taskName: string): boolean {
  const semantics = getPropertyTmsStore()?.get(taskName)
  const words = [taskName, semantics?.taskName ?? '', ...(semantics?.triggerPhrases ?? []), ...readNameSuffixPhrases(taskName)]

  return words.some((word) => toMatchKey(word) === key)
}

/** 후보 문자열이 콘텐츠 이름과 정말 겹치는지만 본다.
 * findContentRef 는 토큰 하나만 겹쳐도 점수를 주는데("없는 장소" vs "도슨트 환영 장소"),
 * 문장에서 잘라 낸 후보에는 그 정도로 느슨하면 엉뚱한 노드가 붙는다.
 */
function matchContentStrict(
  candidate: string,
  taskName: string,
  contents: TaskContentRef[],
  requestText = '',
): TaskContentRef | undefined {
  const taskKey = toMatchKey(taskName)
  const pool = taskKey ? contents.filter((row) => toMatchKey(row.taskName) === taskKey) : contents

  let best: TaskContentRef | undefined
  let bestScore = Number.MAX_SAFE_INTEGER
  let bestLength = 0

  for (const row of pool) {
    const suffixes = readNameSuffixPhrases(row.taskName)
    const contentKeys = buildContentMatchEntries(row.contentName, suffixes)
      .filter((entry) => canUseStrippedKey(entry, requestText || candidate, row.taskName, row.contentName))
      .map((entry) => entry.key)
    const requestKeys = buildContentMatchKeys(candidate, readNameSuffixPhrases(taskName || row.taskName)).filter(
      // 호칭 접미어나 Task 를 부르는 말 자체는 이름이 아니다("장소" 하나로 아무 장소나 잡히면 안 된다).
      (requestKey) => !isTaskWordKey(requestKey, row.taskName),
    )

    for (const contentKey of contentKeys) {
      for (const requestKey of requestKeys) {
        const score = scoreContentMatch(requestKey, contentKey)
        if (score === null) continue
        // 이름의 일부만 겹칠 때는 절반 이상 겹쳐야 인정한다. "대기" -> "대기 장소" 는 되고 "장소" -> "도슨트 환영 장소" 는 안 된다.
        if (score >= 2 && requestKey.length * 2 < contentKey.length) continue
        if (score > bestScore) continue
        if (score === bestScore && contentKey.length <= bestLength) continue

        best = row
        bestScore = score
        bestLength = contentKey.length
      }
    }
  }

  return best
}

/** 제어 노드가 품는 동작의 범위. property_tms.compose_hint.childScope 에서 온다.
 *  - all   : 문장에 나열된 동작 전부를 자식으로 묶는다(동시 실행/조건 분기).
 *  - clause: 자기가 나온 절의 동작만 자식으로 두고, 뒤 절은 그 다음 순서로 잇는다(반복/지연/제한시간).
 * 값이 없으면 all 로 본다(기존 동작 유지).
 */
export function readControlChildScope(taskName: string): 'all' | 'clause' {
  const raw = getPropertyTmsStore()?.get(String(taskName ?? '').trim())?.composeHint?.childScope
  return String(raw ?? '').trim() === 'clause' ? 'clause' : 'all'
}

/** 자식을 동시에 실행하는 제어 Task 인지. compose_hint.intent(또는 intents)가 concurrent 인 Task 다. */
export function isConcurrentControlTask(taskName: string): boolean {
  const semantics = getPropertyTmsStore()?.get(String(taskName ?? '').trim())
  if (!semantics || semantics.taskType !== TASK_TYPE.control) return false

  const single = String(semantics.composeHint?.intent ?? '').trim()
  const many = Array.isArray(semantics.composeHint?.intents)
    ? (semantics.composeHint?.intents as unknown[]).map((value) => String(value ?? '').trim())
    : []

  return [single, ...many].includes('concurrent')
}

/** 동시 실행 제어 노드의 자식 중 이미 쓰인 Task 이름. 같은 Task 를 또 넣지 않기 위해 본다.
 * (얼굴 두 개, 발화 두 개를 동시에 수행할 수는 없다.)
 */
export function readConcurrentChildTaskNames(graph: CurrentGraph, anchorNodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.branch && String(edge.source) === String(anchorNodeId))
    .map((edge) => graph.nodes.find((node) => node.id === edge.target)?.taskName ?? '')
    .filter(Boolean)
}

/** Start 에서 시작하는 실행 흐름의 마지막 노드.
 *
 * 위치를 말하지 않은 "~ 만들어줘 / 추가해줘" 요청을 이 노드 우측에 잇는 데 쓴다.
 * 자식(branch) 엣지는 따라가지 않으므로 제어 노드가 자식을 가지고 있으면 흐름의 끝은 그 제어 노드다.
 * 모든 노드는 입력 엣지가 하나뿐이라, 흐름 끝에 잇는 것이 기존 구성을 건드리지 않는 유일한 방법이다.
 */
export function findFlowTailNode(graph: CurrentGraph): GraphNodeRef | undefined {
  if (graph.nodes.length === 0) return undefined

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const mainEdges = graph.edges.filter((edge) => !edge.branch)
  const nextBySource = new Map<string, string>()
  for (const edge of mainEdges) {
    if (!nextBySource.has(edge.source)) nextBySource.set(edge.source, edge.target)
  }

  const hasMainIncoming = new Set(mainEdges.map((edge) => edge.target))
  // Start(ROOT) 가 있으면 거기서 출발한다. 없으면 흐름 상 앞에 아무것도 없는 노드에서 출발한다.
  const startId =
    graph.nodes.find((node) => node.taskType === TASK_TYPE.root)?.id ??
    graph.nodes.find((node) => !hasMainIncoming.has(node.id))?.id

  if (!startId) return undefined

  let currentId = startId
  let tail: GraphNodeRef | undefined = byId.get(startId)?.taskType === TASK_TYPE.root ? undefined : byId.get(startId)
  const seen = new Set<string>([startId])

  while (true) {
    const nextId = nextBySource.get(currentId)
    if (!nextId || seen.has(nextId)) break

    seen.add(nextId)
    currentId = nextId
    tail = byId.get(nextId) ?? tail
  }

  return tail
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

/** 노드를 사람이 읽는 한 줄로 옮긴다. 표기(괄호)뿐이라 문구가 아니므로 코드에 둔다. */
export function formatNodeLabel(taskName?: string, contentName?: string): string {
  if (!taskName || !contentName) return ''

  return `${contentName}(${taskName})`
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
