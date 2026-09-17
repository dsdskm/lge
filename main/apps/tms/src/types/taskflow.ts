export type ReactFlowObject = {
  [key: string]: unknown | unknown[]
}
export type ReactFlowContent = {
  contentTypeId: number
  contentTypeName: string
  contentValue: string
  createdAt: string
  groupId: string
  id: number
  name: string
  siteId: string
  status: string
  updatedAt: string
  version: string
}

export enum TaskFlowStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  DISABLED = 'DISABLED'
}

export type DeployActionType = 'ACTIVATE' | 'DEACTIVATE' | 'UNDEPLOY' | 'DEPLOY'

// 배포 진행 상태 (tms_be: deployments.constants.ts 의 DeploymentStatus 와 동일)
export enum DeploymentStatus {
  PENDING = 'PENDING', // 배포 대기
  IN_PROGRESS = 'IN_PROGRESS', // 배포 중
  COMPLETED = 'COMPLETED', // 배포 완료
  CANCELED = 'CANCELED', // 배포 취소
  DELETION_IN_PROGRESS = 'DELETION_IN_PROGRESS' // 삭제 중
}

// listTaskFlows(include=lastDeployment) 응답에 포함되는 마지막 배포 정보
// 배포 이력이 없으면 deployment 자체가 존재하지 않음
export interface Deployment {
  id: number
  taskFlowSnapshotId: number
  taskFlowVersion: number
  status: DeploymentStatus
  createdAt: string
  completedAt: string | null
  latestFailedRobotCount?: number
  latestPendingRobotCount?: number
  latestSuccessRobotCount?: number
  totalSuccessRobotCount?: number
}

export interface TaskFlow {
  id: number
  groupId: string | null
  siteId: string | null
  name: string
  flowDefinition: ReactFlowObject
  flowDefinitionDraft: ReactFlowObject
  version: number
  status: TaskFlowStatus
  description?: string
  createdAt: string
  updatedAt: string
  robotSkillIds: number[] // 로봇 스킬 ID 목록
  robotSkillInfos: Record<string, any>[] // 로봇 스킬 정보
  behaviorTree: string
  isPublished: boolean
}

// listTaskFlows(include=lastDeployment) 응답은 마지막 배포 정보(deployment)를 포함할 수 있다.
// (배포 이력이 없으면 deployment 자체가 없음) — base TaskFlow 에는 없는 선택 필드라 별도 타입으로 처리.
export type TaskFlowWithDeployment = TaskFlow & {
  deployment?: Deployment
}

export interface SimpleRobotInfo {
  groupId: string
  siteId: string
  id: string
}
export interface DeployActionRequest {
  taskFlowId: number
  param: {
    groupId: string | null
    siteId: string | null

    action: DeployActionType
    robotInfos: SimpleRobotInfo[] | null
    description: string | null
  }
}
