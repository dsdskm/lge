import type { ToolDefinition } from './tool.type'
import { getPromptStore } from '../features/chat/service/prompt-store.service'
import { CHAT_PROMPT_TYPE } from '../features/chat/prompt-types'
import { listActionTools } from './action-tool-registry'
import { createComposeTaskflowTool } from './tools/compose-taskflow-tree.tool'
import { createEditTaskflowTool } from './tools/edit-taskflow.tool'
import { createReadTaskflowGraphTool } from './tools/read-taskflow-graph.tool'
import { TASKFLOW_TOOL_KEY } from './tools/taskflow-message'

export type ScreenConfig = {
  /** currentApp::currentPath. handleXxx 의 routeKey 와 동일. */
  key: string
  /** 앱 키(예: robot, ota, cms, tms). */
  appKey: string
  /** 화면 표시명(프롬프트/로그용). */
  screenName: string
  /** RAG 컬렉션 키(chat_rag_doc.key). info 인텐트에서 사용. */
  ragCollection: string
  /** data 인텐트 tool 목록. */
  dataTools: ToolDefinition[]
  /** action 인텐트 tool 목록. */
  actionTools: ToolDefinition[]
  /** legacy action agent system prompts. */
  dataSystemPrompt: string
  actionSystemPrompt: string
  /** 공통 key(common)에서만 온 action tool 목록. 실패 시 재시도용. */
  commonActionTools: ToolDefinition[]
  /** 인텐트별 chat_action 값(프론트 분기용). */
  chatActions: { info: string; data: string; action: string }
  /** intent classifier 에 전달할 화면별 프롬프트. */
  intentClassifierPrompt: string
  /** legacy fallback text. */
  fallbackText: string
  /** 현재 screen_key의 screen_guidance.examples. */
  guidanceExamples: string[]
}

function normalizeGuidanceExamples(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return Array.from(new Set(value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      return String((item as Record<string, unknown>).q ?? '').trim()
    })
    .filter(Boolean)))
}

function logPromptMeta(routeKey: string, appKey: string, details: Record<string, { source: string; length: number; enabled: boolean }>) {
  const promptEntries = Object.entries(details)
    .map(([key, value]) => `${key}:${value.enabled ? value.length : 0}:${value.source}`)
    .join(', ')

  console.log(
    `[prompt-meta] route=${routeKey} appKey=${appKey} promptInfo={${promptEntries}} mode=${details.intentHintMode?.source ?? 'unknown'}`,
  )
}

function matchRouteTemplate(template: string, actual: string): boolean {
  const tpl = String(template ?? '').trim().replace(/^\/+/, '')
  const act = String(actual ?? '').trim().replace(/^\/+/, '')
  if (!tpl || !act) return false

  const tplSeg = tpl.split('/').filter(Boolean)
  const actSeg = act.split('/').filter(Boolean)
  if (tplSeg.length !== actSeg.length) return false

  for (let i = 0; i < tplSeg.length; i += 1) {
    const t = tplSeg[i]
    const a = actSeg[i]
    if (!t || !a) return false
    if (t.startsWith(':')) continue
    if (t !== a) return false
  }

  return true
}

function findParameterizedScreenKey(routeKey: string): string | null {
  const normalized = String(routeKey || '').trim().replace(/^\/+/, '')
  if (!normalized) return null

  const store = getPromptStore()
  const screens = store?.getEnabledScreens() ?? []

  const matched = screens
    .map((screen) => String(screen.screenKey ?? '').trim())
    .filter((key) => key && key.includes('/:'))
    .filter((key) => matchRouteTemplate(key, normalized))
    .sort((a, b) => b.length - a.length)[0]

  return matched || null
}

/** action-tools 묶음의 키 -> 그 도구를 만드는 팩토리.
 * 어떤 화면이 어떤 도구를 쓰는지는 화면 키가 아니라 DB(prompt 의 action-tools 행)가 정한다.
 */
const ACTION_TOOL_FACTORIES: Record<string, () => ToolDefinition | null> = {
  [TASKFLOW_TOOL_KEY.compose]: createComposeTaskflowTool,
  [TASKFLOW_TOOL_KEY.edit]: createEditTaskflowTool,
  [TASKFLOW_TOOL_KEY.readGraph]: createReadTaskflowGraphTool,
}

/** 구현체가 있는 도구의 tool key 와 LLM 함수 이름. 표의 llm_function 과 대조하는 데 쓴다.
 * 프론트 함수 이름은 코드 레지스트리(client-actions)와 표의 client_function 이 짝이므로 표 값을 그대로 보여 준다.
 */
export function listActionToolDefinitions(): Array<{ toolKey: string; llmFunction: string }> {
  return Object.entries(ACTION_TOOL_FACTORIES).map(([toolKey, factory]) => ({
    toolKey,
    llmFunction: String(factory()?.declaration?.name ?? ''),
  }))
}

/** action_tool 표에 등록된 순서대로, 구현체가 있는 도구만 만든다.
 * 표에 없으면 그 화면은 도구를 쓰지 않고 action RAG 경로로 내려간다.
 * 구현체가 없는 key(오타 등)나 팩토리가 null 을 주는 경우는 사유를 남겨 설정 누락이 드러나게 한다.
 */
export function resolveActionTools(
  toolKeys: string[],
  factories: Record<string, () => ToolDefinition | null> = ACTION_TOOL_FACTORIES,
): { tools: ToolDefinition[]; skipped: string[]; unknown: string[] } {
  const tools: ToolDefinition[] = []
  const skipped: string[] = []
  const unknown: string[] = []

  for (const key of toolKeys) {
    const factory = factories[key]
    if (!factory) {
      unknown.push(key)
      continue
    }

    const tool = factory()
    if (tool) tools.push(tool)
    else skipped.push(key)
  }

  return { tools, skipped, unknown }
}

function toChatAction(routeKey: string) {
  const normalized = String(routeKey || '').replace(/^\//, '').replace(/^robot\//, '')
  return normalized || 'default'
}

export function getScreenConfig(routeKey: string, reqId?: string): ScreenConfig | undefined {
  const normalizedRouteKey = String(routeKey || '').replace(/^\//, '')
  if (!normalizedRouteKey) return undefined
  const appKey = normalizedRouteKey.split('/').filter(Boolean)[0] || normalizedRouteKey

  const store = getPromptStore()
  let screen = store?.getScreen(normalizedRouteKey)
  if (!screen || screen.enabled === false) {
    const matchedTemplate = findParameterizedScreenKey(normalizedRouteKey)
    if (matchedTemplate) {
      screen = store?.getScreen(matchedTemplate)
    }
  }

  if (!screen || screen.enabled === false) {
    return undefined
  }

  const effectiveRouteKey = screen.screenKey
  const commonInstruction = store?.getPromptContent('common', CHAT_PROMPT_TYPE.instruction) ?? ''
  const commonIntentClassifierPrompt = store?.getPromptContent('common', CHAT_PROMPT_TYPE.intentClassifier) ?? ''
  const screenIntentClassifierPrompt = store?.getPromptContent(effectiveRouteKey, CHAT_PROMPT_TYPE.intentClassifier) ?? ''
  const guidanceExamples = normalizeGuidanceExamples(store?.getGuidance(effectiveRouteKey)?.examples)

  const appIntentClassifierPrompt = store?.getPromptContent(appKey, CHAT_PROMPT_TYPE.intentClassifier) ?? ''
  const intentClassifierPrompt = [commonIntentClassifierPrompt, appIntentClassifierPrompt, screenIntentClassifierPrompt]
    .filter(Boolean)
    .join('\n\n')

  logPromptMeta(effectiveRouteKey, appKey, {
    'common:instruction': { source: 'common', length: commonInstruction.length, enabled: Boolean(commonInstruction) },
    'common:intent-classifier': { source: commonIntentClassifierPrompt ? 'common' : 'missing', length: commonIntentClassifierPrompt.length, enabled: Boolean(commonIntentClassifierPrompt) },
    'app:intent-classifier': { source: appIntentClassifierPrompt ? 'app' : 'missing', length: appIntentClassifierPrompt.length, enabled: Boolean(appIntentClassifierPrompt) },
    'screen:intent-classifier': { source: screenIntentClassifierPrompt ? 'screen' : 'missing', length: screenIntentClassifierPrompt.length, enabled: Boolean(screenIntentClassifierPrompt) },
    'resolved:intent-classifier': { source: 'common+app+screen', length: intentClassifierPrompt.length, enabled: Boolean(intentClassifierPrompt) },
  })

  const dataTools: ToolDefinition[] = []

  const actionTools: ToolDefinition[] = []

  const commonActionTools: ToolDefinition[] = []

  // 어떤 도구를 열어 줄지는 action_tool 표(앱·화면별)가 정한다.
  const registeredToolKeys = listActionTools(effectiveRouteKey).map((row) => row.toolKey)
  const resolved = resolveActionTools(registeredToolKeys)
  actionTools.push(...resolved.tools)

  // 표의 llm_function 이 실제 선언 이름과 다르면 관리 화면이 거짓을 보여 주게 되므로 로그로 드러낸다.
  const registeredRows = listActionTools(effectiveRouteKey)
  const nameMismatch = resolved.tools
    .map((tool, index) => ({ tool, row: registeredRows[index] }))
    .filter(({ tool, row }) => row?.llmFunction && row.llmFunction !== tool.declaration.name)
    .map(({ tool, row }) => `${row?.toolKey}:${row?.llmFunction}!=${tool.declaration.name}`)

  // 표에 행이 없으면 도구 없이 action RAG 경로로 내려간다.
  console.log(
    `[action-tools] route=${effectiveRouteKey} keys=${registeredToolKeys.join(',') || '-'} registered=${actionTools.map((tool) => tool.declaration.name).join(',') || '-'} skipped=${resolved.skipped.join(',') || '-'} unknown=${resolved.unknown.join(',') || '-'} nameMismatch=${nameMismatch.join(',') || '-'}`,
  )

  const baseAction = toChatAction(effectiveRouteKey)
  return {
    key: effectiveRouteKey,
    appKey,
    screenName: screen.screenName,
    ragCollection: effectiveRouteKey,
    dataTools,
    actionTools,
    dataSystemPrompt: '',
    actionSystemPrompt: '',
    commonActionTools,
    chatActions: {
      info: baseAction,
      data: `${baseAction}/filter`,
      action: `${baseAction}/action`,
    },
    intentClassifierPrompt,
    fallbackText: '',
    guidanceExamples,
  }
}
