export const CAMPAIGN_STATUS = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  DELETION_IN_PROGRESS: 'DELETION_IN_PROGRESS'
}

// ── 캠페인 그룹(Rollout Stage) 관련 ──────────────────────────────────────────
// OTA BE의 campaignGroup 개념과 1:1 대응한다. (git/ota: models/campaign/campaignGroup.js, campaign.js)
export const ALLOCATION_TYPE = {
  COUNT: 'count', // 대수 지정
  PERCENT: 'percent' // 비율(%) 지정
}

export const CAMPAIGN_GROUP_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  FAILED: 'FAILED'
}

export const PHASE_STATUS = {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED'
}

export const COMPLETED_PHASE_STATUS = [
  PHASE_STATUS.SUCCEEDED,
  PHASE_STATUS.FAILED,
  PHASE_STATUS.CANCELED
]

// BE는 단계 간 대기시간(waitMinutes)을 0 또는 30분 이상만 허용(AWS 예약 배포 최소 제약).
// 화면은 시간(h) 단위로 입력받으므로 0 또는 1시간 이상만 유효하다.
export const MIN_OBSERVATION_HOURS = 1
export const MAX_STAGE_COUNT = 10

export const DEPLOYMENT_STATUS = {
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  REJECTED: 'REJECTED',
  REMOVED: 'REMOVED',
  CANCELED: 'CANCELED'
}
