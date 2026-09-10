import { CHAT_PROMPT_TYPE } from '../../features/chat/prompt-types'
import { renderMessage } from '../message-bundle.util'

/** taskflow 도구와 prompt 조회가 같이 쓰는 캔버스 화면 키. */
export const TASKFLOW_CANVAS_SCREEN_KEY = 'tms/taskflows/:taskFlowId/canvas'

/** action_tool 표의 tool_key. 도구의 정체성이라 프롬프트 키와 별개로 둔다.
 * (ACTION_TOOL_FACTORIES 조회와 client_function 조회에 쓴다.)
 */
export const TASKFLOW_TOOL_KEY = {
  compose: 'tool.compose',
  edit: 'tool.edit',
  readGraph: 'tool.readGraph',
} as const

/** prompt 테이블의 action-tools 행에 JSON 으로 들어 있는 키들.
 *
 * 키는 세 갈래로만 둔다. 어디로 가는 문구인지가 키에 드러나야 프롬프트를 줄일 때 무엇을 건드릴지 알 수 있다.
 *  - llm.*  : LLM 요청에 실리는 문구(정책, tool 설명, 파라미터 설명, 노드별 지침)
 *  - ui.*   : 서버가 사용자에게 돌려주는 문구. LLM 에는 가지 않는다.
 *
 * "{{a}}({{b}})" 같은 표기나 개수 한도처럼 번역할 문구가 아닌 값은 프롬프트가 아니라 코드에 둔다.
 *
 * 노드별 지침은 `llm.tool.<tool>.node.<taskName 소문자>` 로 나눠 둔다.
 * 카탈로그(property_tms)에 있는 Task 것만 골라 tool 설명의 {{nodeGuides}} 자리에 붙으므로,
 * 노드를 추가할 때 코드가 아니라 프롬프트 키만 늘리면 되고 쓰지 않는 지침은 LLM 에 실리지 않는다.
 */
export const TASKFLOW_MESSAGE_KEY = {
  /** action tool 사용 규칙. {{mutatingTools}} 를 채운다. */
  policy: 'llm.policy',
  toolCompose: 'llm.tool.compose.desc',
  toolEdit: 'llm.tool.edit.desc',
  toolReadGraph: 'llm.tool.readGraph.desc',

  composeParamNodes: 'llm.tool.compose.param.nodes',
  composeParamDepth: 'llm.tool.compose.param.depth',
  composeParamTaskName: 'llm.tool.compose.param.taskName',
  composeParamContentName: 'llm.tool.compose.param.contentName',
  composeParamProperties: 'llm.tool.compose.param.properties',

  editParamOperations: 'llm.tool.edit.param.operations',
  editParamAction: 'llm.tool.edit.param.action',
  editParamTarget: 'llm.tool.edit.param.target',
  editParamAfter: 'llm.tool.edit.param.after',
  editParamTaskName: 'llm.tool.edit.param.taskName',
  editParamContentName: 'llm.tool.edit.param.contentName',
  editParamBranch: 'llm.tool.edit.param.branch',
  editParamAll: 'llm.tool.edit.param.all',
  editParamRefId: 'llm.tool.edit.param.refId',
  editParamProperties: 'llm.tool.edit.param.properties',
  editParamChild: 'llm.tool.edit.param.child',
  editParamRole: 'llm.tool.edit.param.role',

  graphEmpty: 'ui.graph.empty',
  graphChildren: 'ui.graph.children',
  graphNext: 'ui.graph.next',

  composeDone: 'ui.compose.done',
  composeSubstituted: 'ui.compose.substituted',
  composePlaceholders: 'ui.compose.placeholders',
  composeMissing: 'ui.compose.missing',
  composeUnresolved: 'ui.compose.unresolved',
  composeRootRequired: 'ui.compose.rootRequired',
  composeDepthSkipped: 'ui.compose.depthSkipped',
  composeParentMissing: 'ui.compose.parentMissing',
  composeTaskNotFound: 'ui.compose.taskNotFound',
  composeEmptyControl: 'ui.compose.emptyControl',
  composeUnknownProperties: 'ui.compose.unknownProperties',
  /** 동시 실행 제어 노드 아래에서 같은 Task 라 넣지 않았음을 알리는 문구. */
  composeDuplicateConcurrent: 'ui.compose.duplicateConcurrent',

  editDone: 'ui.edit.done',
  editPlaceholders: 'ui.edit.placeholders',
  editMissing: 'ui.edit.missing',
  editAmbiguous: 'ui.edit.ambiguous',
  editEmptyCanvas: 'ui.edit.emptyCanvas',
  editAmbiguousClarification: 'ui.edit.ambiguousClarification',
  editNotFound: 'ui.edit.notFound',
  editAppliedRemove: 'ui.edit.appliedRemove',
  editAppliedReplace: 'ui.edit.appliedReplace',
  editAppliedClone: 'ui.edit.appliedClone',
  editAppliedProperty: 'ui.edit.appliedProperty',
  editAppliedRole: 'ui.edit.appliedRole',
  editAppliedAppend: 'ui.edit.appliedAppend',
  editAppliedAppendAfter: 'ui.edit.appliedAppendAfter',
  editAppliedAppendBranch: 'ui.edit.appliedAppendBranch',
  editCloneTargetMissing: 'ui.edit.cloneTargetMissing',
  /** 스키마에 없는 속성 키를 알리는 문구. */
  editUnknownProperties: 'ui.edit.unknownProperties',
  /** 동시 실행 제어 노드 아래에서 같은 Task 라 붙이지 않았음을 알리는 문구. */
  editDuplicateConcurrent: 'ui.edit.duplicateConcurrent',
} as const

/** 노드별 지침 키. tool 은 TASKFLOW_TOOL_KEY 의 값('tool.compose')이 아니라 짧은 이름을 쓴다. */
export function taskflowNodeGuideKey(tool: 'compose' | 'edit', taskName: string): string {
  return `llm.tool.${tool}.node.${String(taskName ?? '').trim().toLowerCase()}`
}

export function taskflowMessage(key: string, vars: Record<string, string> = {}): string {
  return renderMessage(TASKFLOW_CANVAS_SCREEN_KEY, CHAT_PROMPT_TYPE.actionTools, key, vars)
}

/** 주어진 Task 이름들 중 지침이 있는 것만 카탈로그 순서대로 이어 붙인다.
 * 지침에서 {{task}} 는 그 Task 이름으로 채운다.
 */
export function taskflowNodeGuides(
  tool: 'compose' | 'edit',
  taskNames: string[],
  vars: Record<string, string> = {},
): string {
  return taskNames
    .map((taskName) => taskflowMessage(taskflowNodeGuideKey(tool, taskName), { ...vars, task: taskName }))
    .filter(Boolean)
    .join('\n')
}
