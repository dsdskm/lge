import { client } from '@repo/apis'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ENDPOINTS } from './apiConstants'
import {
  ACTION_CONTENT_TARGET_NONE,
  ACTION_CONTENT_TARGETS,
  CAPABILITY_SKILL_ID,
  MANAGED_TASK_TYPES,
  type Action,
  type ActionCapability,
  type ActionContentTarget,
  type ActionDraft,
  type ActionParam,
  type ActionParamDirection,
  type ActionParamType,
  type ActionStatus,
  type ManagedTaskType
} from '@/types/action'
import type { TaskListResponse, TaskPropertyDef, TaskPropertySchema, TaskResponse } from '@/types/api/task'

const axiosClient = client(import.meta.env.VITE_API_BASE_URL)
const path = ENDPOINTS.TMS.TASKS

/**
 * groupId/siteId 는 필수 쿼리 파라미터이고 'all' 이 와일드카드다.
 * (all/all → 전체 공용, A/all → 전체+그룹 공용, A/B → 전체+그룹+사이트)
 * 'none'(미지정)은 이 API 가 모르는 값이라 'all' 로 낮춘다.
 */
const ORG_ALL = 'all'
const ORG_NONE = 'none'

function normalizeOrg(value?: string | null): string {
  if (!value || value === ORG_NONE) return ORG_ALL
  return value
}

// ──────────────────────────────────────────────────────────────
// 매퍼 (서버 DTO ↔ 화면 모델)
// ──────────────────────────────────────────────────────────────

function makeParamUid(): string {
  return `param-${crypto.randomUUID()}`
}

function toDirection(value?: string): ActionParamDirection {
  return value === 'out' || value === 'inout' ? value : 'in'
}

function toParam(name: string, def: TaskPropertyDef): ActionParam {
  return {
    uid: makeParamUid(),
    name,
    type: def?.type as ActionParamType,
    defaultValue: def?.default === undefined || def?.default === null ? undefined : String(def.default),
    required: Boolean(def?.required),
    direction: toDirection(def?.direction),
    contentType: typeof def?.content_type === 'string' ? def.content_type : undefined,
    itemType: typeof def?.item_type === 'string' ? def.item_type : undefined,
    internal: Boolean(def?.internal),
    raw: def as Record<string, unknown>
  }
}

/** content_reference 파라미터의 content_type 을 연동 대상으로 본다. 여러 개면 첫 번째. */
function toContentTarget(params: ActionParam[]): ActionContentTarget {
  for (const param of params) {
    if (param.type !== 'content_reference') continue
    const contentType = param.raw?.content_type
    if (typeof contentType !== 'string') continue
    if ((ACTION_CONTENT_TARGETS as readonly string[]).includes(contentType)) {
      return contentType as ActionContentTarget
    }
  }
  return ACTION_CONTENT_TARGET_NONE
}

/** skill 이름은 응답의 robotSkillInfo 에서 온다. skill 이 없는 Task 가 많아 null 이 정상이다. */
function toCapability(dto: TaskResponse): ActionCapability | null {
  const name = dto.robotSkillInfo?.name
  return name && name in CAPABILITY_SKILL_ID ? (name as ActionCapability) : null
}

export function toAction(dto: TaskResponse): Action {
  const schema = dto.propertySchema ?? {}
  const properties = schema.properties ?? {}
  const params = Object.entries(properties).map(([name, def]) => toParam(name, def ?? {}))

  return {
    id: dto.id,
    name: dto.name,
    taskType: (dto.taskType as ManagedTaskType) ?? 'ACTION',
    capability: toCapability(dto),
    robotSkillId: dto.robotSkillId ?? null,
    description: dto.description,
    // 전체 공용 Task 는 groupId·siteId 가 모두 null 로 내려온다.
    builtIn: dto.groupId == null && dto.siteId == null,
    contentTarget: toContentTarget(params),
    version: dto.version ?? '',
    minExecVer: dto.minExecVer ?? '',
    isDeployable: dto.isDeployable ?? false,
    status: (dto.status as ActionStatus) ?? 'ACTIVE',
    inputs: params.filter((param) => param.direction !== 'out'),
    outputs: params.filter((param) => param.direction !== 'in'),
    groupId: dto.groupId,
    siteId: dto.siteId,
    rawPropertySchema: schema as Record<string, unknown>
  }
}

/**
 * 화면 값 → 서버 요청 바디.
 *
 * propertySchema 는 원본을 복제한 뒤 properties 만 교체한다. 이렇게 해야
 *  - properties 밖에 있는 값(Tts 처럼 서버 데이터가 어긋난 경우)이 유실되지 않고
 *  - 각 속성의 constraints 처럼 화면이 모르는 필드도 남는다.
 */
function toPropertySchema(action: ActionDraft): TaskPropertySchema {
  const base: TaskPropertySchema = { ...(action.rawPropertySchema ?? {}) }
  const nextProperties: Record<string, TaskPropertyDef> = {}

  // 같은 이름이 입력·출력 양쪽에 있으면 inout 이다.
  const outputNames = new Set(action.outputs.map((param) => param.name))
  const inputNames = new Set(action.inputs.map((param) => param.name))

  const merge = (param: ActionParam) => {
    const direction: ActionParamDirection =
      inputNames.has(param.name) && outputNames.has(param.name) ? 'inout' : param.direction

    const previous = (param.raw ?? {}) as TaskPropertyDef
    const next: TaskPropertyDef = {
      ...previous,
      type: param.type,
      required: Boolean(param.required),
      direction
    }

    if (param.defaultValue == null || param.defaultValue === '') {
      delete next.default
    } else {
      next.default = param.defaultValue
    }

    // 타입을 바꾸면 이전 타입에만 의미가 있던 키가 남지 않도록 정리한다.
    if (param.type === 'content_reference' && param.contentType) {
      next.content_type = param.contentType
    } else {
      delete next.content_type
    }

    if (param.type === 'array' && param.itemType) {
      next.item_type = param.itemType
    } else {
      delete next.item_type
    }

    if (param.internal) next.internal = true

    nextProperties[param.name] = next
  }

  action.inputs.forEach(merge)
  action.outputs.forEach(merge)

  base.properties = nextProperties
  return base
}

function toTaskRequest(action: ActionDraft) {
  return {
    // 편집 화면에 조직 선택이 없으므로 기존 값을 유지한다(신규는 전체 공용).
    groupId: action.groupId ?? null,
    siteId: action.siteId ?? null,
    taskType: action.taskType,
    name: action.name,
    propertySchema: toPropertySchema(action),
    minExecVer: action.minExecVer || undefined,
    version: action.version,
    description: action.description || undefined,
    isDeployable: action.isDeployable,
    status: action.status,
    robotSkillId: action.capability ? CAPABILITY_SKILL_ID[action.capability] : null
  }
}

// ──────────────────────────────────────────────────────────────
// API
// ──────────────────────────────────────────────────────────────

export type ListActionsParams = {
  groupId?: string | null
  siteId?: string | null
}

export async function listActions(params?: ListActionsParams): Promise<Action[]> {
  const searchParams = new URLSearchParams({
    groupId: normalizeOrg(params?.groupId),
    siteId: normalizeOrg(params?.siteId)
  })

  // include=contents 는 붙이지 않는다. 관리 목록에 contents 가 필요 없고, 붙이면 페이징이 불가하다.
  const response = (await axiosClient.get(`${path}?${searchParams.toString()}`)) as TaskListResponse
  const items = Array.isArray(response?.content) ? response.content : []

  // taskType 서버 필터가 없어 클라이언트에서 걸러낸다. ROOT(Start)는 관리 대상이 아니다.
  return items
    .filter((item) => (MANAGED_TASK_TYPES as readonly string[]).includes(item.taskType))
    .map(toAction)
    .sort(compareActions)
}

/**
 * 목록 정렬: ACTION 묶음 먼저, 그 다음 CONTROL. 같은 타입 안에서는 이름 오름차순.
 * (서버가 순서를 보장하지 않아 여기서 정한다)
 */
function compareActions(a: Action, b: Action): number {
  const rankA = MANAGED_TASK_TYPES.indexOf(a.taskType)
  const rankB = MANAGED_TASK_TYPES.indexOf(b.taskType)
  if (rankA !== rankB) return rankA - rankB
  return a.name.localeCompare(b.name)
}

export async function getAction(actionId: number): Promise<Action | undefined> {
  const response = (await axiosClient.get(`${path}/${actionId}`)) as TaskResponse
  return response ? toAction(response) : undefined
}

export async function createAction(draft: ActionDraft): Promise<Action> {
  const response = (await axiosClient.post(path, toTaskRequest(draft))) as TaskResponse
  return toAction(response)
}

export async function updateAction(action: ActionDraft & { id: number }): Promise<Action> {
  const response = (await axiosClient.patch(`${path}/${action.id}`, toTaskRequest(action))) as TaskResponse
  return toAction(response)
}

export async function deleteAction(actionId: number): Promise<void> {
  await axiosClient.delete(`${path}/${actionId}`)
}

const ACTION_QUERY_KEY = 'tms_actions'

export function useListActions(params?: ListActionsParams) {
  return useQuery({
    // 같은 엔드포인트를 캔버스 팔레트(include=contents)도 쓰므로 키를 분리해 둔다.
    queryKey: [ACTION_QUERY_KEY, 'list', normalizeOrg(params?.groupId), normalizeOrg(params?.siteId)],
    queryFn: () => listActions(params)
  })
}

export function useGetAction(actionId: number) {
  return useQuery({
    queryKey: [ACTION_QUERY_KEY, 'detail', actionId],
    queryFn: () => getAction(actionId),
    enabled: Number.isFinite(actionId) && actionId > 0
  })
}

/**
 * 신규 생성/수정을 한 훅으로 처리한다. id 가 있으면 수정(PATCH)이다.
 * 성공 시 목록·상세 쿼리를 무효화해 저장 결과가 바로 반영되게 한다.
 */
export function useSaveAction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (draft: ActionDraft) =>
      draft.id != null && draft.id > 0 ? updateAction(draft as ActionDraft & { id: number }) : createAction(draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACTION_QUERY_KEY] })
    }
  })
}

export function useDeleteAction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (actionId: number) => deleteAction(actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACTION_QUERY_KEY] })
    }
  })
}
