import type { RFEdge, RFNode } from '@/store/taskflow.canvas.store'
import type { PaletteItem } from '@/types/palette'

/** AI Assistant Test 버튼이 쓰는 기대값. 정의는 @repo/constants 의 AI_TASKFLOW_TEST_CASES 에 있다. */
export type AiTestExpectation = {
  nodes?: Array<{ name: string; count?: number }>
  absent?: string[]
  childOf?: Array<{ parent: string; children: string[] }>
  nextOf?: Array<{ from: string; to: string }>
  props?: Array<{ name: string; key: string; value: unknown }>
  /** 그 이름의 콘텐츠가 팔레트에 없어 같은 Task 의 다른 콘텐츠로 대체될 수 있는 경우의 Task 이름.
   * (예: `작별 인사` 가 없으면 Tts 의 다른 콘텐츠로 대체된다. 그래도 구성은 맞은 것으로 본다.)
   */
  aliasTask?: Record<string, string>
}

export type AiTestVerifyResult = {
  ok: boolean
  failures: string[]
  /** 판정 근거로 같이 보여 줄 캔버스 요약. */
  graph: { nodes: string[]; childEdges: string[]; nextEdges: string[] }
}

const normalizeName = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')

const nodeLabel = (node: RFNode | undefined): string => {
  const data = (node?.data ?? {}) as Record<string, unknown>
  return String(data.label ?? data.contentName ?? data.taskName ?? node?.id ?? '').trim()
}

/** 좌측 핸들에서 나가는 연결이 제어 노드의 자식이다(캔버스 규칙과 같다). */
const isChildEdge = (edge: RFEdge): boolean => String((edge as any).sourceHandle ?? '') === 'left'

/** 노드를 이름으로 찾는다. 라벨이 없으면 Task 이름으로도 찾는다(Parallel 처럼 제어 노드).
 * 이름이 하나도 없으면 aliasTask 에 적힌 Task 의 노드로 대신 본다(대체된 콘텐츠도 성공으로 본다).
 */
const findNodesByName = (name: string, nodes: RFNode[], aliasTask?: Record<string, string>): RFNode[] => {
  const key = normalizeName(name)
  if (!key) return []

  const exact = nodes.filter((node) => {
    if (String(node.id) === 'start') return false
    const data = (node.data ?? {}) as Record<string, unknown>
    return normalizeName(nodeLabel(node)) === key || normalizeName(data.taskName) === key
  })
  if (exact.length > 0) return exact

  const aliasKey = normalizeName(aliasTask?.[name])
  if (!aliasKey) return []

  return nodes.filter((node) => {
    if (String(node.id) === 'start') return false
    const data = (node.data ?? {}) as Record<string, unknown>
    return normalizeName(data.taskName) === aliasKey
  })
}

export function verifyCanvasExpectation(
  expectation: AiTestExpectation | undefined,
  nodes: RFNode[],
  edges: RFEdge[]
): AiTestVerifyResult {
  const expected = expectation ?? {}
  const aliasTask = expected.aliasTask ?? {}
  const failures: string[] = []
  const byId = new Map(nodes.map((node) => [String(node.id), node]))
  const describeEdge = (edge: RFEdge) =>
    `${nodeLabel(byId.get(String(edge.source))) || String(edge.source)} -> ${nodeLabel(byId.get(String(edge.target))) || String(edge.target)}`

  for (const want of expected.nodes ?? []) {
    const found = findNodesByName(want.name, nodes, aliasTask)
    const count = Number.isFinite(Number(want.count)) ? Number(want.count) : 1
    if (found.length !== count) {
      failures.push(`노드 "${want.name}" 개수 ${count} 기대, 실제 ${found.length}`)
    }
  }

  for (const name of expected.absent ?? []) {
    const found = findNodesByName(name, nodes)
    if (found.length > 0) failures.push(`노드 "${name}" 가 생기면 안 되는데 ${found.length}개 있음`)
  }

  for (const rule of expected.childOf ?? []) {
    const parents = findNodesByName(rule.parent, nodes, aliasTask)
    if (parents.length === 0) {
      failures.push(`자식 확인 불가: 기준 노드 "${rule.parent}" 없음`)
      continue
    }

    // 같은 이름 기준 노드가 여러 개면 기대 자식을 모두 가진 노드가 하나라도 있으면 통과다.
    // 이름을 슬롯으로 채운 자식(aliasTask 에 있는 이름)은 다른 노드로 대체돼도 통과로 본다.
    // 요청한 이름이 팔레트에 딱 맞지 않을 때 대체·제외를 알리고 넣는 것도 정상 동작이다.
    const matched = parents.some((parent) => {
      const childNodes = edges
        .filter((edge) => String(edge.source) === String(parent.id) && isChildEdge(edge))
        .map((edge) => byId.get(String(edge.target)))
      const unclaimed = [...childNodes]
      const takeChild = (predicate: (child: RFNode | undefined) => boolean): boolean => {
        const at = unclaimed.findIndex(predicate)
        if (at < 0) return false
        unclaimed.splice(at, 1)
        return true
      }

      // 이름이 그대로 맞는 자식을 먼저 짝지어 두고, 남은 기대만 대체로 본다.
      const pending = rule.children.filter(
        (child) => !takeChild((node) => normalizeName(nodeLabel(node)) === normalizeName(child))
      )

      return pending.every((child) => {
        const aliasKey = normalizeName(aliasTask[child])
        if (!aliasKey) return false
        if (takeChild((node) => normalizeName(((node?.data ?? {}) as Record<string, unknown>).taskName) === aliasKey))
          return true
        // 같은 Task 조차 없으면 다른 노드로 대체된 경우다. 자리(자식 수)만 채워져 있으면 통과.
        return takeChild(() => true)
      })
    })
    if (!matched) failures.push(`"${rule.parent}" 자식에 ${rule.children.join(', ')} 가 모두 없음`)
  }

  for (const rule of expected.nextOf ?? []) {
    const sources = findNodesByName(rule.from, nodes, aliasTask)
    if (sources.length === 0) {
      failures.push(`순차 연결 확인 불가: 기준 노드 "${rule.from}" 없음`)
      continue
    }

    const matched = sources.some((source) =>
      edges.some(
        (edge) =>
          String(edge.source) === String(source.id) &&
          !isChildEdge(edge) &&
          (normalizeName(nodeLabel(byId.get(String(edge.target)))) === normalizeName(rule.to) ||
            (Boolean(normalizeName(aliasTask[rule.to])) &&
              normalizeName(
                ((byId.get(String(edge.target))?.data ?? {}) as Record<string, unknown>).taskName
              ) === normalizeName(aliasTask[rule.to])))
      )
    )
    if (!matched) failures.push(`"${rule.from}" 다음이 "${rule.to}" 가 아님`)
  }

  for (const rule of expected.props ?? []) {
    const targets = findNodesByName(rule.name, nodes, aliasTask)
    if (targets.length === 0) {
      failures.push(`속성 확인 불가: 노드 "${rule.name}" 없음`)
      continue
    }

    const matched = targets.some((node) => {
      const properties = ((node.data ?? {}) as Record<string, unknown>).properties as
        | Record<string, unknown>
        | undefined
      return String(properties?.[rule.key] ?? '') === String(rule.value)
    })
    if (!matched) failures.push(`"${rule.name}" 의 ${rule.key} 가 ${String(rule.value)} 아님`)
  }

  return {
    ok: failures.length === 0,
    failures,
    graph: {
      nodes: nodes.filter((node) => String(node.id) !== 'start').map((node) => nodeLabel(node)),
      childEdges: edges.filter(isChildEdge).map(describeEdge),
      nextEdges: edges.filter((edge) => !isChildEdge(edge)).map(describeEdge)
    }
  }
}

/** 테스트 문장에 박아 두지 않고 실제 팔레트에서 뽑아 쓸 이름 슬롯.
 *  - task      : 팔레트의 Task 이름(PlayFace, Tts, MoveTo ...)
 *  - index     : 그 Task 의 몇 번째 콘텐츠인지(콘텐츠 id 순, 기본 0)
 *  - kind      : 'content'(기본) 는 콘텐츠 이름, 'task' 는 Task 이름 자체를 쓴다(Pause 처럼 콘텐츠가 없는 Task)
 *  - transform : 이름의 모양 자체가 시험 대상인 경우의 변형
 *      stripSuffix       괄호/접미어를 뗀 형태. "도슨트 대기(D1)" -> "도슨트 대기"
 *      stripLeadingIndex 앞머리 번호를 뗀 형태. "1.인트로" -> "인트로"
 *      typo              두 글자를 바꿔 오타를 만든다. "pause" -> "puase"
 */
export type AiTestSlotSpec = {
  task: string
  index?: number
  kind?: 'content' | 'task'
  transform?: 'stripSuffix' | 'stripLeadingIndex' | 'typo'
}

export type AiTestCase = {
  key?: string
  title?: string
  setup?: string[]
  message?: string
  expect?: AiTestExpectation
  slots?: Record<string, AiTestSlotSpec>
}

export type AiTestResolvedCase = AiTestCase & {
  /** 팔레트에 필요한 콘텐츠가 없어 실행하지 못하는 이유. 있으면 그 케이스는 건너뛴다. */
  skipReason?: string
  /** 슬롯이 실제로 어떤 이름으로 채워졌는지. 보고에 그대로 보여 준다. */
  resolvedSlots: Record<string, string>
}

type PaletteContentRow = { taskName: string; contentName: string; contentId: number }

function readPaletteContents(palette: PaletteItem[]): PaletteContentRow[] {
  return palette
    .filter((item): item is Extract<PaletteItem, { kind: 'contentNode' }> => item.kind === 'contentNode')
    .map((item) => ({
      taskName: String(item.task?.name ?? '').trim(),
      contentName: String(item.content?.name ?? '').trim(),
      contentId: Number(item.content?.id ?? 0)
    }))
    .filter((row) => Boolean(row.taskName) && Boolean(row.contentName))
}

/** 괄호와 그 안의 말, 그리고 뒤에 붙은 호칭을 뗀 형태. Task 접미어는 팔레트가 모르므로 괄호만 다룬다. */
function stripNameSuffix(name: string): string {
  return name
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripLeadingIndex(name: string): string {
  return name.replace(/^\s*\d+\s*[.)\-_]?\s*/, '').trim()
}

/** 붙어 있는 두 글자를 바꿔 오타를 만든다. 짧은 이름은 엉뚱한 노드로 튈 수 있어 그대로 둔다. */
function makeTypo(name: string): string {
  const text = name.trim()
  if (text.length < 4) return text
  const chars = [...text]
  const at = 1
  ;[chars[at], chars[at + 1]] = [chars[at + 1], chars[at]]
  return chars.join('')
}

function applyTransform(name: string, transform: AiTestSlotSpec['transform']): string {
  if (transform === 'stripSuffix') return stripNameSuffix(name)
  if (transform === 'stripLeadingIndex') return stripLeadingIndex(name)
  if (transform === 'typo') return makeTypo(name)
  return name
}

/** 문자열 안의 {{슬롯}} 을 실제 이름으로 바꾼다. 객체/배열은 키까지 함께 훑는다. */
function fillTemplate<T>(value: T, slots: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, name) => slots[name] ?? whole) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillTemplate(item, slots)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const filled: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      filled[fillTemplate(key, slots)] = fillTemplate(item, slots)
    }
    return filled as unknown as T
  }
  return value
}

/** 케이스의 슬롯을 현재 팔레트 이름으로 채운다.
 * 필요한 콘텐츠가 팔레트에 없으면 채우지 않고 skipReason 을 준다(없는 이름으로 돌리면 판정이 무의미하다).
 */
export function resolveTestCaseSlots(testCase: AiTestCase, palette: PaletteItem[]): AiTestResolvedCase {
  const specs = testCase.slots ?? {}
  const contents = readPaletteContents(palette)
  const byTask = new Map<string, PaletteContentRow[]>()
  for (const row of contents) {
    const key = normalizeName(row.taskName)
    const bucket = byTask.get(key)
    if (bucket) bucket.push(row)
    else byTask.set(key, [row])
  }
  for (const bucket of byTask.values()) bucket.sort((a, b) => a.contentId - b.contentId)

  const resolvedSlots: Record<string, string> = {}
  const missing: string[] = []

  for (const [slotName, spec] of Object.entries(specs)) {
    if (spec.kind === 'task') {
      resolvedSlots[slotName] = applyTransform(String(spec.task ?? '').trim(), spec.transform)
      continue
    }

    const bucket = byTask.get(normalizeName(spec.task)) ?? []
    const picked = bucket[spec.index ?? 0]
    if (!picked) {
      missing.push(`${spec.task}[${spec.index ?? 0}]`)
      continue
    }
    resolvedSlots[slotName] = applyTransform(picked.contentName, spec.transform)
  }

  if (missing.length > 0) {
    return {
      ...testCase,
      resolvedSlots,
      skipReason: `팔레트에 필요한 콘텐츠가 없습니다: ${missing.join(', ')}`
    }
  }

  const filledExpect = fillTemplate(testCase.expect ?? {}, resolvedSlots)

  // 콘텐츠 슬롯으로 채운 이름은 같은 Task 의 다른 콘텐츠로 대체되어도 구성은 맞은 것으로 본다.
  const slotAliasTask: Record<string, string> = {}
  for (const [slotName, spec] of Object.entries(specs)) {
    if (spec.kind === 'task') continue
    const filledName = resolvedSlots[slotName]
    if (filledName) slotAliasTask[filledName] = String(spec.task ?? '').trim()
  }

  return {
    ...testCase,
    message: fillTemplate(testCase.message ?? '', resolvedSlots),
    setup: fillTemplate(testCase.setup ?? [], resolvedSlots),
    expect: { ...filledExpect, aliasTask: { ...slotAliasTask, ...(filledExpect.aliasTask ?? {}) } },
    resolvedSlots
  }
}
