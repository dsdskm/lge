import { getRuleReader } from './rule-registry'

export type TaskflowLanguageRules = {
  composeNoisePhrases: string[]
  requestTailPhrases: string[]
  composeVerbPhrases: string[]
  taskflowKeywordPhrases: string[]
  composeSignalPhrases: string[]
  nodeLevelEditPhrases: string[]
  nodePlaceholderPhrases: string[]
  nodePlaceholderPrefixPhrases: string[]
  modeRequestPhrases: string[]
  modeDirectionTreePhrases: string[]
  modeDirectionDefaultPhrases: string[]
  saveRequestPhrases: string[]
  saveDecisionHintPhrases: string[]
  saveTypeTempPhrases: string[]
  saveTypeFinalPhrases: string[]
  resetAllPhrases: string[]
  deleteRequestPhrases: string[]
  deleteAllScopePhrases: string[]
  alignRequestPhrases: string[]
  moveComposeHintPhrases: string[]
  pickupComposeHintPhrases: string[]
  playMotionComposeHintPhrases: string[]
  docentHintPhrases: string[]
  connectIntentPhrases: string[]
  connectPairSeparatorPhrases: string[]
  connectLeftPairSeparatorPhrases: string[]
  /** "두" -> 2 처럼 순번을 세는 말. 언어별 표기를 코드에 두지 않으려 rule 에서 읽는다. */
  nodeTargetOrdinalWords: Record<string, number>
  /** 순번 뒤에 붙는 말. 예: "번째" */
  nodeTargetOrdinalSuffixPhrases: string[]
  /** 노드 이름 뒤에 붙는 군더더기. 예: "노드" */
  nodeTargetNounPhrases: string[]
}

export type TaskflowClassifierRules = {
  explanationKeywords: string[]
  composeRequestKeywords: string[]
  composeMoveHintKeywords: string[]
  editSubjectKeywords: string[]
  editVerbKeywords: string[]
  explanationBlockKeywords: string[]
  arrowSequenceEnabled: boolean
  explanationImageMinScore: number
  explanationImageMinScoreAlways: number
  nodeEditDeletePrefixes: string[]
  arrowChainSeparators: string[]
  /** "~하면서", "동시에" 처럼 동작을 같이 실행하라는 말. Parallel 구성 요청 신호다. */
  concurrentHintKeywords: string[]
  /** "재생해줘", "표시되게" 처럼 동작 자체를 시키는 말. editVerb 가 없어도 편집 요청으로 본다. */
  actionRequestKeywords: string[]
  /** "~해서", "~하고", "그리고" 처럼 한 문장을 여러 동작으로 끊는 말. 복합 문장을 절 단위로 자를 때 쓴다. */
  clauseSeparatorPhrases: string[]
  /** 절에서 노드 이름을 뽑을 때 떼어 낼 조사/군더더기. 예: "로", "으로", "좀" */
  clauseNoisePhrases: string[]
}

export type TaskflowOrchestratorRules = {
  nodeClarificationPhrases: string[]
  nodeDeleteClarificationPhrases: string[]
  modeClarificationPhrases: string[]
  saveClarificationPhrases: string[]
  nodeNameBlockedPhrases: string[]
  nodeNameOnlyMaxLength: number
  nodeAppendSuffix: string
  nodeAppendWithNodeSuffix: string
  deleteAppendSuffix: string
  deleteAppendWithNodeSuffix: string
  modeAppendSuffix: string
  saveTempMessage: string
  saveFinalMessage: string
  guideInfoCuePhrases: string[]
  guideActionCuePhrases: string[]
  nodeGuideSubjectPhrases: string[]
  nodeGuideRequestPhrases: string[]
  ruleFirstIntentConfidence: number
  actionRetryDeleteExample: string
  actionRetryConnectExample: string
  actionRetryComposeExample: string
  actionRetryDefaultExample: string
  actionRetryRunActionExample: string
}

const CACHE_TTL_MS = 10_000

type CachedRules = {
  at: number
  data: TaskflowLanguageRules
}

type ScopeRuleMaps = {
  scoped: Record<string, unknown>
}

const rulesCache = new Map<string, CachedRules>()
const classifierRulesCache = new Map<string, { at: number; data: TaskflowClassifierRules }>()
const orchestratorRulesCache = new Map<string, { at: number; data: TaskflowOrchestratorRules }>()

export function clearTaskflowRulesCache(routeKey?: string): void {
  if (routeKey) {
    const scopeKey = keyFor(routeKey)
    rulesCache.delete(scopeKey)
    classifierRulesCache.delete(`classifier:${scopeKey}`)
    orchestratorRulesCache.delete(`orchestrator:${scopeKey}`)
    return
  }

  rulesCache.clear()
  classifierRulesCache.clear()
  orchestratorRulesCache.clear()
}

function normalizePhraseList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const list = value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
  return Array.from(new Set(list))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseToPattern(value: string): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''

  return tokens.map((token) => escapeRegExp(token)).join('\\s*')
}

export function buildConfiguredPhraseRegex(phrases: string[], flags = 'gi'): RegExp | null {
  const parts = (Array.isArray(phrases) ? phrases : [])
    .map((phrase) => phraseToPattern(phrase))
    .filter(Boolean)

  if (parts.length === 0) return null
  return new RegExp(parts.join('|'), flags)
}

export function replaceConfiguredPhrases(text: string, phrases: string[], replacement = ' '): string {
  const compiled = buildConfiguredPhraseRegex(phrases)
  if (!compiled) return text
  return text.replace(compiled, replacement)
}

export function includesConfiguredPhrase(text: string, phrases: string[]): boolean {
  const compiled = buildConfiguredPhraseRegex(phrases, 'i')
  if (!compiled) return false
  return compiled.test(String(text ?? ''))
}

export function normalizeForSignalMatch(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function keyFor(routeKey: string): string {
  return String(routeKey ?? '').trim() || '__common__'
}

function scopeForRules(routeKey: string): string {
  return String(routeKey ?? '').trim()
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toStringValue(value: unknown, fallback = ''): string {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const COMMON_RULE_SCOPE = 'common'

/** rule.extra_json 에 담긴 값. {"value": [...]} 형태와 값 자체를 그대로 넣은 형태를 모두 받는다. */
function readRuleValue(row: { extraJson?: unknown; example?: string[] | null }): unknown {
  const extra = row?.extraJson
  if (extra !== null && extra !== undefined && !Array.isArray(extra) && typeof extra === 'object') {
    const holder = extra as Record<string, unknown>
    if (holder.value !== undefined) return holder.value
    if (Object.keys(holder).length === 0) return row?.example ?? undefined
    return undefined
  }
  if (extra !== null && extra !== undefined) return extra
  return row?.example ?? undefined
}

function routeAppKey(routeKey: string): string {
  const normalized = String(routeKey ?? '').trim().replace(/^\/+/, '')
  return normalized.split('/').filter(Boolean)[0] || COMMON_RULE_SCOPE
}

/** 화면 -> 앱 -> common 순으로 먼저 찾은 값을 쓴다. 코드에 기본값을 두지 않고 전부 rule 테이블에서 읽는다. */
async function readScopeRuleMaps(routeKey: string): Promise<ScopeRuleMaps> {
  const service = getRuleReader()
  if (!service) {
    console.warn('[taskflow-rules] rule service unavailable. taskflow 규칙을 읽지 못했다.')
    return { scoped: {} }
  }

  const screenKey = scopeForRules(routeKey)
  const appKey = routeAppKey(screenKey)

  const [scopedRows, commonRows] = await Promise.all([
    service.listByAppAndScreen(appKey, screenKey),
    appKey === COMMON_RULE_SCOPE
      ? Promise.resolve([])
      : service.listByAppAndScreen(COMMON_RULE_SCOPE, COMMON_RULE_SCOPE),
  ])

  const scoped: Record<string, unknown> = {}
  for (const row of [...scopedRows, ...commonRows]) {
    if (row?.enabled === false) continue

    const key = String(row?.ruleKey ?? '').trim()
    if (!key || scoped[key] !== undefined) continue

    const value = readRuleValue(row)
    if (value === undefined) continue
    scoped[key] = value
  }

  return { scoped }
}

function readMergedList(ruleMaps: ScopeRuleMaps, ruleName: string): string[] {
  return normalizePhraseList(ruleMaps.scoped[ruleName])
}

/** {"두": 2} 또는 ["두=2"] 두 표기를 모두 받는다. 값이 없으면 빈 맵이라 기능이 그냥 꺼진다. */
function readMergedNumberMap(ruleMaps: ScopeRuleMaps, ruleName: string): Record<string, number> {
  const raw = ruleMaps.scoped[ruleName]
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map((item) => {
        const [word = '', value = ''] = String(item ?? '').split(/[=:]/)
        return [word.trim(), value.trim()] as [string, unknown]
      })
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>)
      : []

  const map: Record<string, number> = {}
  for (const [word, value] of entries) {
    const key = String(word ?? '').trim()
    const ordinal = Number(value)
    if (!key || !Number.isInteger(ordinal) || ordinal <= 0) continue
    map[key] = ordinal
  }
  return map
}

function readMergedString(ruleMaps: ScopeRuleMaps, ruleName: string, fallback = ''): string {
  return toStringValue(ruleMaps.scoped[ruleName], fallback)
}

function readMergedBoolean(ruleMaps: ScopeRuleMaps, ruleName: string, fallback = false): boolean {
  return toBoolean(ruleMaps.scoped[ruleName], fallback)
}

function readMergedNumber(ruleMaps: ScopeRuleMaps, ruleName: string, fallback: number): number {
  return toNumber(ruleMaps.scoped[ruleName], fallback)
}

async function readRules(routeKey: string): Promise<TaskflowLanguageRules> {
  const ruleMaps = await readScopeRuleMaps(routeKey)

  return {
    composeNoisePhrases: readMergedList(ruleMaps, 'composeNoisePhrases'),
    requestTailPhrases: readMergedList(ruleMaps, 'requestTailPhrases'),
    composeVerbPhrases: readMergedList(ruleMaps, 'composeVerbPhrases'),
    taskflowKeywordPhrases: readMergedList(ruleMaps, 'taskflowKeywordPhrases'),
    composeSignalPhrases: readMergedList(ruleMaps, 'composeSignalPhrases'),
    nodeLevelEditPhrases: readMergedList(ruleMaps, 'nodeLevelEditPhrases'),
    nodePlaceholderPhrases: readMergedList(ruleMaps, 'nodePlaceholderPhrases'),
    nodePlaceholderPrefixPhrases: readMergedList(ruleMaps, 'nodePlaceholderPrefixPhrases'),
    modeRequestPhrases: readMergedList(ruleMaps, 'modeRequestPhrases'),
    modeDirectionTreePhrases: readMergedList(ruleMaps, 'modeDirectionTreePhrases'),
    modeDirectionDefaultPhrases: readMergedList(ruleMaps, 'modeDirectionDefaultPhrases'),
    saveRequestPhrases: readMergedList(ruleMaps, 'saveRequestPhrases'),
    saveDecisionHintPhrases: readMergedList(ruleMaps, 'saveDecisionHintPhrases'),
    saveTypeTempPhrases: readMergedList(ruleMaps, 'saveTypeTempPhrases'),
    saveTypeFinalPhrases: readMergedList(ruleMaps, 'saveTypeFinalPhrases'),
    resetAllPhrases: readMergedList(ruleMaps, 'resetAllPhrases'),
    deleteRequestPhrases: readMergedList(ruleMaps, 'deleteRequestPhrases'),
    deleteAllScopePhrases: readMergedList(ruleMaps, 'deleteAllScopePhrases'),
    alignRequestPhrases: readMergedList(ruleMaps, 'alignRequestPhrases'),
    moveComposeHintPhrases: readMergedList(ruleMaps, 'moveComposeHintPhrases'),
    pickupComposeHintPhrases: readMergedList(ruleMaps, 'pickupComposeHintPhrases'),
    playMotionComposeHintPhrases: readMergedList(ruleMaps, 'playMotionComposeHintPhrases'),
    docentHintPhrases: readMergedList(ruleMaps, 'docentHintPhrases'),
    connectIntentPhrases: readMergedList(ruleMaps, 'connectIntentPhrases'),
    connectPairSeparatorPhrases: readMergedList(ruleMaps, 'connectPairSeparatorPhrases'),
    connectLeftPairSeparatorPhrases: readMergedList(ruleMaps, 'connectLeftPairSeparatorPhrases'),
    nodeTargetOrdinalWords: readMergedNumberMap(ruleMaps, 'nodeTargetOrdinalWords'),
    nodeTargetOrdinalSuffixPhrases: readMergedList(ruleMaps, 'nodeTargetOrdinalSuffixPhrases'),
    nodeTargetNounPhrases: readMergedList(ruleMaps, 'nodeTargetNounPhrases'),
  }
}

export async function loadTaskflowLanguageRules(routeKey: string): Promise<TaskflowLanguageRules> {
  const cacheKey = keyFor(routeKey)
  const cached = rulesCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data
  }

  const data = await readRules(routeKey)
  rulesCache.set(cacheKey, { at: Date.now(), data })
  return data
}

async function readClassifierRules(routeKey: string): Promise<TaskflowClassifierRules> {
  const ruleMaps = await readScopeRuleMaps(routeKey)

  return {
    explanationKeywords: readMergedList(ruleMaps, 'explanationKeywords'),
    composeRequestKeywords: readMergedList(ruleMaps, 'composeRequestKeywords'),
    composeMoveHintKeywords: readMergedList(ruleMaps, 'composeMoveHintKeywords'),
    editSubjectKeywords: readMergedList(ruleMaps, 'editSubjectKeywords'),
    editVerbKeywords: readMergedList(ruleMaps, 'editVerbKeywords'),
    explanationBlockKeywords: readMergedList(ruleMaps, 'explanationBlockKeywords'),
    arrowSequenceEnabled: readMergedBoolean(ruleMaps, 'arrowSequenceEnabled', false),
    explanationImageMinScore: readMergedNumber(ruleMaps, 'explanationImageMinScore', 0),
    explanationImageMinScoreAlways: readMergedNumber(ruleMaps, 'explanationImageMinScoreAlways', 0),
    nodeEditDeletePrefixes: readMergedList(ruleMaps, 'nodeEditDeletePrefixes'),
    arrowChainSeparators: readMergedList(ruleMaps, 'arrowChainSeparators'),
    concurrentHintKeywords: readMergedList(ruleMaps, 'concurrentHintKeywords'),
    actionRequestKeywords: readMergedList(ruleMaps, 'actionRequestKeywords'),
    clauseSeparatorPhrases: readMergedList(ruleMaps, 'clauseSeparatorPhrases'),
    clauseNoisePhrases: readMergedList(ruleMaps, 'clauseNoisePhrases'),
  }
}

export async function loadTaskflowClassifierRules(routeKey: string): Promise<TaskflowClassifierRules> {
  const cacheKey = `classifier:${keyFor(routeKey)}`
  const cached = classifierRulesCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data
  }

  const data = await readClassifierRules(routeKey)
  classifierRulesCache.set(cacheKey, { at: Date.now(), data })
  return data
}

async function readOrchestratorRules(routeKey: string): Promise<TaskflowOrchestratorRules> {
  const ruleMaps = await readScopeRuleMaps(routeKey)

  return {
    nodeClarificationPhrases: readMergedList(ruleMaps, 'nodeClarificationPhrases'),
    nodeDeleteClarificationPhrases: readMergedList(ruleMaps, 'nodeDeleteClarificationPhrases'),
    modeClarificationPhrases: readMergedList(ruleMaps, 'modeClarificationPhrases'),
    saveClarificationPhrases: readMergedList(ruleMaps, 'saveClarificationPhrases'),
    nodeNameBlockedPhrases: readMergedList(ruleMaps, 'nodeNameBlockedPhrases'),
    nodeNameOnlyMaxLength: readMergedNumber(ruleMaps, 'nodeNameOnlyMaxLength', 0),
    nodeAppendSuffix: readMergedString(ruleMaps, 'nodeAppendSuffix'),
    nodeAppendWithNodeSuffix: readMergedString(ruleMaps, 'nodeAppendWithNodeSuffix'),
    deleteAppendSuffix: readMergedString(ruleMaps, 'deleteAppendSuffix'),
    deleteAppendWithNodeSuffix: readMergedString(ruleMaps, 'deleteAppendWithNodeSuffix'),
    modeAppendSuffix: readMergedString(ruleMaps, 'modeAppendSuffix'),
    saveTempMessage: readMergedString(ruleMaps, 'saveTempMessage'),
    saveFinalMessage: readMergedString(ruleMaps, 'saveFinalMessage'),
    guideInfoCuePhrases: readMergedList(ruleMaps, 'guideInfoCuePhrases'),
    guideActionCuePhrases: readMergedList(ruleMaps, 'guideActionCuePhrases'),
    nodeGuideSubjectPhrases: readMergedList(ruleMaps, 'nodeGuideSubjectPhrases'),
    nodeGuideRequestPhrases: readMergedList(ruleMaps, 'nodeGuideRequestPhrases'),
    ruleFirstIntentConfidence: readMergedNumber(ruleMaps, 'ruleFirstIntentConfidence', 0),
    actionRetryDeleteExample: readMergedString(ruleMaps, 'actionRetryDeleteExample'),
    actionRetryConnectExample: readMergedString(ruleMaps, 'actionRetryConnectExample'),
    actionRetryComposeExample: readMergedString(ruleMaps, 'actionRetryComposeExample'),
    actionRetryDefaultExample: readMergedString(ruleMaps, 'actionRetryDefaultExample'),
    actionRetryRunActionExample: readMergedString(ruleMaps, 'actionRetryRunActionExample'),
  }
}

export async function loadTaskflowOrchestratorRules(routeKey: string): Promise<TaskflowOrchestratorRules> {
  const cacheKey = `orchestrator:${keyFor(routeKey)}`
  const cached = orchestratorRulesCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data
  }

  const data = await readOrchestratorRules(routeKey)
  orchestratorRulesCache.set(cacheKey, { at: Date.now(), data })
  return data
}
