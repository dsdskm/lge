/**
 * "A 장소 이동해서 B 발화하고 ... 그리고 C 로 돌아오게 해줘" 같은 복합 문장을
 * LLM 없이 노드/엣지 구성으로 바꾼다.
 *
 * 규칙:
 *  - 절 구분어(clauseSeparatorPhrases)로 문장을 동작 단위로 자른다.
 *  - 절 안에서 팔레트 콘텐츠 이름을 먼저 찾는다. 이름이 잡히면 그 콘텐츠의 Task 가 곧 Task 다.
 *    ("도슨트 대기 장소로 돌아오게" 는 '돌아'(Rotate) 가 아니라 MoveTo/도슨트 대기 장소다.)
 *  - 콘텐츠를 못 찾으면 property_tms.trigger_phrases 로 Task 만 정한다. ('이동' -> MoveTo, '발화' -> Tts)
 *  - 절 사이 연결은 순차(depth 0 나열)다. 동시 실행 문구는 compose 쪽 wrapConcurrentRootsIfNeeded 가 묶는다.
 *
 * 문구는 전부 rule 테이블(clauseSeparatorPhrases / clauseNoisePhrases)과
 * property_tms(trigger_phrases)에서 온다. 코드에는 어떤 표현도 두지 않는다.
 */
import type { TaskSemantics } from '../../features/taskflow/service/property-tms-store.service'
import { buildContentMatchKeys, toMatchKey, type TaskContentRef } from './taskflow-palette'

export type NlComposeNode = {
  depth: number
  taskName: string
  contentName?: string
}

export type NlComposeClause = {
  clause: string
  taskName?: string
  contentName?: string
  /** Task 를 정한 근거. content=콘텐츠 이름 매칭, trigger=발화 표현 매칭 */
  matchedBy?: 'content' | 'trigger'
  matchedPhrase?: string
}

export type NlComposeResult = {
  nodes: NlComposeNode[]
  clauses: NlComposeClause[]
}

export type NlComposeRules = {
  clauseSeparatorPhrases: string[]
  clauseNoisePhrases: string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 절 구분어가 나오는 지점마다 끊는다. 구분어는 앞 절에 남겨 Task 표현을 잃지 않게 한다. */
export function splitClauses(message: string, separators: string[]): string[] {
  const text = String(message ?? '').trim()
  if (!text) return []

  const usable = separators
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (usable.length === 0) return [text]

  const pattern = new RegExp(usable.map(escapeRegExp).join('|'), 'g')
  const clauses: string[] = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length
    const clause = text.slice(cursor, end).trim()
    if (clause) clauses.push(clause)
    cursor = end
  }

  const tail = text.slice(cursor).trim()
  if (tail) clauses.push(tail)

  return clauses.filter((clause) => toMatchKey(clause).length > 0)
}

/** 절 안에 이름이 들어 있는 콘텐츠. 가장 길게 겹치는 이름이 이긴다.
 * 비교 후보(이름 전체 / 괄호 제거 / 호칭 접미어 제거)는 palette 가 property_tms 를 보고 만든다.
 */
function findContentInClause(
  clause: string,
  contents: TaskContentRef[],
  suffixesByTask: Map<string, string[]>,
): TaskContentRef | undefined {
  const clauseKey = toMatchKey(clause)
  if (!clauseKey) return undefined

  let best: TaskContentRef | undefined
  let bestLength = 0

  for (const row of contents) {
    const suffixes = suffixesByTask.get(toMatchKey(row.taskName)) ?? []
    for (const contentKey of buildContentMatchKeys(row.contentName, suffixes)) {
      if (!clauseKey.includes(contentKey)) continue
      if (contentKey.length <= bestLength) continue

      best = row
      bestLength = contentKey.length
    }
  }

  return best
}

/** 절 안에 나오는 trigger_phrases 중 가장 긴 것으로 Task 를 정한다. */
function findTaskByTrigger(
  clause: string,
  tasks: TaskSemantics[],
): { task: TaskSemantics; phrase: string } | undefined {
  const clauseKey = toMatchKey(clause)
  if (!clauseKey) return undefined

  let best: { task: TaskSemantics; phrase: string } | undefined
  let bestLength = 0

  for (const task of tasks) {
    for (const phrase of task.triggerPhrases ?? []) {
      const phraseKey = toMatchKey(phrase)
      if (phraseKey.length < 2 || !clauseKey.includes(phraseKey)) continue
      if (phraseKey.length <= bestLength) continue

      best = { task, phrase }
      bestLength = phraseKey.length
    }
  }

  return best
}

/** trigger 로만 Task 를 정한 절에서 콘텐츠 후보 이름을 뽑는다. 같은 Task 의 콘텐츠 안에서만 본다. */
function findContentByTask(
  clause: string,
  taskName: string,
  contents: TaskContentRef[],
  rules: NlComposeRules,
  suffixesByTask: Map<string, string[]>,
): TaskContentRef | undefined {
  const taskKey = toMatchKey(taskName)
  const scoped = contents.filter((row) => toMatchKey(row.taskName) === taskKey)
  if (scoped.length === 0) return undefined

  const noise = rules.clauseNoisePhrases
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  let cleaned = String(clause ?? '')
  for (const phrase of noise) {
    cleaned = cleaned.split(phrase).join(' ')
  }

  return findContentInClause(cleaned, scoped, suffixesByTask)
}

/** Task 별 호칭 접미어. property_tms.compose_hint.nameSuffixes 에서 온다. */
function buildSuffixMap(tasks: TaskSemantics[]): Map<string, string[]> {
  const map = new Map<string, string[]>()

  for (const task of tasks) {
    const raw = (task.composeHint as Record<string, unknown> | undefined)?.nameSuffixes
    const suffixes = Array.isArray(raw)
      ? raw.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
    map.set(toMatchKey(task.taskName), suffixes)
  }

  return map
}

/**
 * 복합 문장을 순차 노드 목록으로 바꾼다.
 * Task 를 못 정한 절은 노드를 만들지 않고 clauses 에만 남겨 응답에서 드러내게 한다.
 */
export function parseComposeNodesFromMessage(
  message: string,
  tasks: TaskSemantics[],
  contents: TaskContentRef[],
  rules: NlComposeRules,
): NlComposeResult {
  const clauses = splitClauses(message, rules.clauseSeparatorPhrases)
  const suffixesByTask = buildSuffixMap(tasks)
  const parsed: NlComposeClause[] = []
  const nodes: NlComposeNode[] = []

  for (const clause of clauses) {
    const triggerMatch = findTaskByTrigger(clause, tasks)
    // 발화 표현이 잡히면 그 Task 의 콘텐츠부터 본다. "돌아오게"(Rotate) 처럼 겹치는 표현 때문에
    // 콘텐츠를 먼저 잡으면 Task 가 뒤집히는 경우가 있어, 두 결과를 비교해 콘텐츠 쪽을 우선한다.
    const scopedContent = triggerMatch
      ? findContentByTask(clause, triggerMatch.task.taskName, contents, rules, suffixesByTask)
      : undefined
    const anyContent = scopedContent ?? findContentInClause(clause, contents, suffixesByTask)

    if (anyContent) {
      parsed.push({
        clause,
        taskName: anyContent.taskName,
        contentName: anyContent.contentName,
        matchedBy: 'content',
        matchedPhrase: anyContent.contentName,
      })
      nodes.push({ depth: 0, taskName: anyContent.taskName, contentName: anyContent.contentName })
      continue
    }

    if (triggerMatch) {
      parsed.push({
        clause,
        taskName: triggerMatch.task.taskName,
        matchedBy: 'trigger',
        matchedPhrase: triggerMatch.phrase,
      })
      nodes.push({ depth: 0, taskName: triggerMatch.task.taskName })
      continue
    }

    parsed.push({ clause })
  }

  return { nodes, clauses: parsed }
}
