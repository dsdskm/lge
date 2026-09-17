/**
 * Action(Task) 관리 화면 도메인 타입.
 *
 * 서버의 Task 리소스(GET/POST/PATCH/DELETE /api/v1/web/tasks)를 화면에서 다루기 쉬운 형태로
 * 옮긴 뷰 모델이다. 서버 DTO 와 1:1 이 아니며, 변환은 actionApis.ts 의 매퍼가 담당한다.
 *
 * 서버 타입(types/task.ts 의 Task)을 직접 쓰지 않는 이유:
 *  - propertySchema 가 "이름 → 정의" 맵인데 화면은 순서·편집을 위해 배열이 필요하다
 *  - 입력/출력을 direction 으로 나눠 보여준다
 */
import { CONTENT_TYPE } from '@/common/contentTypes'

/** 관리 대상 taskType. ROOT(Start)는 시스템 전용이라 목록에서 제외한다. */
export const MANAGED_TASK_TYPES = ['ACTION', 'CONTROL'] as const
export type ManagedTaskType = (typeof MANAGED_TASK_TYPES)[number]

/** 로봇 능력(skill). 서버 robotSkillInfo.name 과 같은 값 집합이다. */
export const ACTION_CAPABILITIES = ['NAVIGATION', 'MANIPULATION', 'VOICE', 'DISPLAY', 'PERCEPTION'] as const
export type ActionCapability = (typeof ACTION_CAPABILITIES)[number]

/**
 * capability → 서버 robotSkillId.
 *
 * skill 은 서버에서 하드코딩 운영이고 목록 API 가 없어 여기에 상수로 둔다.
 * id 가 비연속(1, 4, 6, 7, 12)이므로 임의로 추가·추론하면 안 된다.
 * (GET /tasks 응답의 robotSkillId ↔ robotSkillInfo.name 쌍에서 확인한 값)
 */
export const CAPABILITY_SKILL_ID: Record<ActionCapability, number> = {
  NAVIGATION: 1,
  DISPLAY: 4,
  VOICE: 6,
  MANIPULATION: 7,
  PERCEPTION: 12
}

/** 파라미터 타입. 서버 propertySchema 의 type 값 집합을 그대로 쓴다. */
export const ACTION_PARAM_TYPES = ['int', 'double', 'bool', 'string', 'content_reference', 'object', 'array'] as const
export type ActionParamType = (typeof ACTION_PARAM_TYPES)[number]

/** 파라미터 방향. 화면에서는 in/inout 을 입력, out/inout 을 출력으로 나눠 보여준다. */
export const ACTION_PARAM_DIRECTIONS = ['in', 'out', 'inout'] as const
export type ActionParamDirection = (typeof ACTION_PARAM_DIRECTIONS)[number]

/** Task 상태. 서버 enum 과 동일. */
export const ACTION_STATUSES = ['ACTIVE', 'DEPRECATED', 'INACTIVE'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

/** 연동 대상(콘텐츠 종류). 없으면 NONE. */
export const ACTION_CONTENT_TARGET_NONE = 'NONE'

/** CONTENT_TYPE 에는 없지만 서버 Task 가 실제로 쓰고 있는 content_type 값. */
export const EXTRA_CONTENT_TARGETS = ['SERVICE', 'LEARN'] as const

export const ACTION_CONTENT_TARGETS = [
  ACTION_CONTENT_TARGET_NONE,
  ...Object.values(CONTENT_TYPE),
  ...EXTRA_CONTENT_TARGETS
] as const
export type ActionContentTarget = (typeof ACTION_CONTENT_TARGETS)[number]

export type ActionParam = {
  /**
   * 편집 화면에서 행을 식별하는 로컬 키. 파라미터는 이름을 바꿀 수 있고 순서도 바뀌므로
   * 이름·인덱스를 React key 로 쓰면 입력 도중 포커스가 튄다. 서버로는 보내지 않는다.
   */
  uid: string
  name: string
  type: ActionParamType
  /** 기본값. 타입이 달라도 화면에서는 문자열로 다루고 표시 시점에만 해석한다. */
  defaultValue?: string
  required?: boolean
  direction: ActionParamDirection
  /** type 이 content_reference 일 때 연동할 콘텐츠 종류(서버 content_type). */
  contentType?: string
  /** type 이 array 일 때의 요소 타입. */
  itemType?: string
  /** 내부 전용 속성(예: Parallel.main_nodes). 사용자가 채우는 값이 아니다. */
  internal?: boolean
  /**
   * 서버가 준 원본 속성 정의.
   *
   * 실데이터에 스펙 문서에 없는 필드(constraints 의 min/max/enum 등)가 있어서,
   * 저장할 때 화면이 아는 필드만으로 다시 만들면 나머지가 사라진다.
   * 그래서 원본을 들고 있다가 저장 시 이 값 위에 덮어쓴다.
   */
  raw?: Record<string, unknown>
}

export type Action = {
  id: number
  /** 표시 이름이면서 식별용 코드 역할도 한다(MoveTo, PlaySound 등). 서버에 별도 코드 필드는 없다. */
  name: string
  taskType: ManagedTaskType
  /** robotSkillInfo.name. skill 이 지정되지 않은 Task 가 많아 null 이 정상이다. */
  capability: ActionCapability | null
  robotSkillId: number | null
  description?: string
  /** groupId·siteId 가 모두 비어 있으면 전체 공용 = 기본 제공. */
  builtIn: boolean
  /** content_reference 파라미터의 content_type 에서 유도한 값. 서버에 별도 필드는 없다. */
  contentTarget: ActionContentTarget
  version: string
  minExecVer: string
  isDeployable: boolean
  status: ActionStatus
  inputs: ActionParam[]
  outputs: ActionParam[]
  groupId?: string | null
  siteId?: string | null
  /**
   * 서버가 준 propertySchema 원본.
   *
   * properties 밖에 값이 들어 있는 Task(예: Tts)가 실제로 존재해서, properties 만 새로 만들어
   * 보내면 그 값이 유실된다. 저장 시 이 원본을 복제해 properties 만 교체한다.
   */
  rawPropertySchema?: Record<string, unknown>
}

/** 신규 추가 화면에서 쓰는 빈 Action. id 는 저장 시 서버가 발급한다. */
export type ActionDraft = Omit<Action, 'id'> & { id?: number }

/** capability 별 기본 아이콘(@repo/ui Icon 이름). */
export const CAPABILITY_ICON: Record<ActionCapability, string> = {
  NAVIGATION: 'location',
  MANIPULATION: 'robot',
  VOICE: 'voice',
  DISPLAY: 'smile',
  PERCEPTION: 'eye_open'
}

/**
 * capability 별 색(아이콘 배경 · 태그).
 * SkillIndicator 와 값이 다른데, 시안에 정의된 배색을 따른 것이다.
 */
export const CAPABILITY_COLOR: Record<ActionCapability, string> = {
  NAVIGATION: '#7ba5c1',
  MANIPULATION: '#f59e0b',
  VOICE: '#9333ea',
  DISPLAY: '#10b981',
  PERCEPTION: '#0ea5e9'
}

/** skill 이 없는 Task 용 기본값. */
const NO_CAPABILITY_ICON = 'category'
const NO_CAPABILITY_COLOR = '#94a3b8'

export function capabilityIcon(capability: ActionCapability | null): string {
  return capability ? CAPABILITY_ICON[capability] : NO_CAPABILITY_ICON
}

export function capabilityColor(capability: ActionCapability | null): string {
  return capability ? CAPABILITY_COLOR[capability] : NO_CAPABILITY_COLOR
}
