/**
 * Task 리소스(/api/v1/web/tasks)의 서버 DTO.
 *
 * Swagger 의 TaskResponseDto / CreateTaskDto 중 화면이 쓰는 부분만 옮겼다.
 * 화면에서 쓰는 모델은 types/action.ts 의 Action 이고, 변환은 api/actionApis.ts 의 매퍼가 맡는다.
 *
 * 주의: 같은 엔드포인트를 캔버스도 쓰지만, 그쪽은 include=contents 응답을 정규화한
 * types/api/taskPayload.ts 의 TaskApiPayload 를 따로 갖고 있다.
 */

/**
 * propertySchema.properties 의 개별 속성 정의.
 *
 * 인덱스 시그니처를 둔 이유: 스펙 문서에 없는 필드(constraints 의 min/max/enum 등)가
 * 실데이터에 존재한다. 저장할 때 원본을 병합해 보존해야 하므로 타입에서 잘라내지 않는다.
 */
export type TaskPropertyDef = {
  type?: string
  default?: unknown
  required?: boolean
  direction?: string
  description?: string
  content_type?: string
  item_type?: string
  internal?: boolean
  [key: string]: unknown
}

/**
 * properties 를 감싸는 스키마.
 * 인덱스 시그니처는 properties 밖에 값이 들어 있는 Task(Tts 의 repeat_count)를 잃지 않기 위한 것이다.
 */
export type TaskPropertySchema = {
  properties?: Record<string, TaskPropertyDef>
  [key: string]: unknown
}

export type TaskResponse = {
  id: number
  groupId: string | null
  siteId: string | null
  taskType: string
  robotSkillId: number | null
  robotSkillInfo?: { name?: string; displayName?: string } | null
  name: string
  propertySchema?: TaskPropertySchema
  minExecVer?: string
  version?: string
  description?: string
  isDeployable?: boolean
  status?: string
  createdAt?: string
  updatedAt?: string
}

export type TaskListResponse = {
  content?: TaskResponse[]
}
