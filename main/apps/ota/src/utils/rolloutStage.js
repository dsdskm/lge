import { ALLOCATION_TYPE, MIN_OBSERVATION_HOURS } from '@/constants/campaign'

// Rollout Stage(캠페인 그룹 단계) 계산/검증 유틸.
// OTA BE의 util/campaignGroup/deviceDivider.js + services/campaignGroup.service.js의 규칙을
// 화면 프리뷰/사전 검증용으로 이식했다. BE는 device 배열을 분할하지만 화면은 총 대수만 알면 되므로
// "개수 계산"만 옮긴다.
//   - percent : count = round(total * value / 100)
//   - count   : count = value
//   - 마지막 단계는 자기 할당이 잔여 이상일 때만(예: 100%) 잔여를 모두 흡수하고,
//     그보다 작게 지정하면 지정한 수만 배정한다(남은 대수는 미배정).

const MIN_WAIT_MINUTES = MIN_OBSERVATION_HOURS * 60

const toNumber = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value))

/**
 * 단계별 배정 대수를 계산한다. 잘못된 입력은 0으로 처리하고 검증은 validateStages가 담당한다.
 * @param {number} total  분할 대상 총 대수
 * @param {Array} stages  [{ allocationType, allocationValue }]
 * @returns {number[]} 단계별 배정 대수(입력 순서)
 */
export const divideStageCounts = (total, stages) => {
  if (!Array.isArray(stages) || stages.length === 0) return []

  const totalUnits = Number.isFinite(total) && total > 0 ? total : 0
  const counts = []
  let assigned = 0

  stages.forEach((stage) => {
    const value = toNumber(stage.allocationValue)
    let count = 0
    if (Number.isFinite(value) && value >= 0) {
      count =
        stage.allocationType === ALLOCATION_TYPE.PERCENT ? Math.round((totalUnits * value) / 100) : Math.floor(value)
    }
    // 남은 대수를 넘지 않도록 클램프 (초과 여부는 validateStages가 에러로 알려준다)
    count = Math.min(count, Math.max(totalUnits - assigned, 0))
    counts.push(count)
    assigned += count
  })

  return counts
}

/**
 * 저장 전 사전 검증. BE saveCampaignGroup의 검증을 미러링해 왕복을 줄인다.
 * @returns {{ errors: Object[], messages: string[] }} errors[i]는 i번째 단계의 필드별 에러 키
 */
export const validateStages = (stages, total, t) => {
  const errors = stages.map(() => ({}))
  const messages = []

  if (!Array.isArray(stages) || stages.length === 0) {
    messages.push(t('stageValidation.empty'))
    return { errors, messages }
  }

  const totalUnits = Number.isFinite(total) && total > 0 ? total : 0
  if (totalUnits === 0) {
    messages.push(t('stageValidation.noDevice'))
  }

  const stageCounts = divideStageCounts(totalUnits, stages)
  const seenDeviceIds = new Set()

  let assigned = 0
  stages.forEach((stage, index) => {
    const stageNo = index + 1
    const isLast = index === stages.length - 1
    const value = toNumber(stage.allocationValue)
    const successRate = toNumber(stage.successThreshold)
    const hours = toNumber(stage.observationHours)
    const selectedIds = stage.deviceIds || []

    if (stage.allocationType === ALLOCATION_TYPE.PERCENT) {
      if (!(Number.isFinite(value) && value >= 0 && value <= 100)) {
        errors[index].allocationValue = true
        messages.push(t('stageValidation.percentRange', { stage: stageNo }))
      }
    } else if (stage.allocationType === ALLOCATION_TYPE.COUNT) {
      if (!(Number.isFinite(value) && Number.isInteger(value) && value >= 0)) {
        errors[index].allocationValue = true
        messages.push(t('stageValidation.countRange', { stage: stageNo }))
      }
    } else {
      errors[index].allocationType = true
      messages.push(t('stageValidation.allocationType', { stage: stageNo }))
    }

    if (!(Number.isFinite(successRate) && successRate >= 0 && successRate <= 100)) {
      errors[index].successThreshold = true
      messages.push(t('stageValidation.successRate', { stage: stageNo }))
    }

    // 마지막 단계의 관찰 시간은 다음 단계가 없어 미사용 → 검증 생략
    if (!isLast && !(hours === 0 || (Number.isFinite(hours) && hours >= MIN_OBSERVATION_HOURS))) {
      errors[index].observationHours = true
      messages.push(t('stageValidation.observationTime', { stage: stageNo, min: MIN_OBSERVATION_HOURS }))
    }

    // 누적 할당이 전체 대수를 넘지 않아야 한다 (마지막 단계는 잔여 흡수라 검사 제외)
    if (!isLast && !errors[index].allocationValue && totalUnits > 0) {
      const count =
        stage.allocationType === ALLOCATION_TYPE.PERCENT ? Math.round((totalUnits * value) / 100) : Math.floor(value)
      if (assigned + count > totalUnits) {
        errors[index].allocationValue = true
        messages.push(t('stageValidation.exceedTotal', { stage: stageNo, remain: totalUnits - assigned }))
      }
      assigned += count
    }

    // 로봇을 직접 지정한 단계는 선택 대수가 배정 대수와 같아야 하고, 단계 간 중복이 없어야 한다.
    // (BE divideDevicesWithSelection과 동일한 규칙)
    if (selectedIds.length > 0) {
      if (selectedIds.length !== stageCounts[index]) {
        errors[index].deviceIds = true
        messages.push(
          t('stageValidation.selectionCount', {
            stage: stageNo,
            selected: selectedIds.length,
            required: stageCounts[index]
          })
        )
      }
      const duplicated = selectedIds.find((deviceId) => seenDeviceIds.has(deviceId))
      if (duplicated !== undefined) {
        errors[index].deviceIds = true
        messages.push(t('stageValidation.selectionDuplicated', { stage: stageNo }))
      }
      selectedIds.forEach((deviceId) => seenDeviceIds.add(deviceId))
    }
  })

  // 0대 배정 단계는 BE에서 배포 완료 이벤트가 오지 않아 진행이 멈추므로 사전 차단한다.
  if (totalUnits > 0 && messages.length === 0) {
    divideStageCounts(totalUnits, stages).forEach((count, index) => {
      if (count === 0) {
        errors[index].allocationValue = true
        messages.push(t('stageValidation.emptyStage', { stage: index + 1 }))
      }
    })
  }

  return { errors, messages }
}

/**
 * 화면 상태 → BE campaign-group phases payload
 * 마지막 단계의 waitMinutes는 사용되지 않으므로 0으로 정규화한다(BE도 동일하게 처리).
 */
export const toPhasePayload = (stages) =>
  stages.map((stage, index) => ({
    allocationType: stage.allocationType,
    allocationValue: Number(stage.allocationValue),
    successThreshold: Number(stage.successThreshold),
    waitMinutes: index === stages.length - 1 ? 0 : Number(stage.observationHours) * 60,
    // 미지정(빈 배열)이면 BE가 순서대로 자동 분할한다
    ...(stage.deviceIds?.length > 0 ? { deviceIds: stage.deviceIds } : {})
  }))

/**
 * BE phase(Campaign) 응답 → 화면 상태
 */
export const toStageState = (phases) =>
  [...phases]
    .sort((a, b) => a.phaseSequence - b.phaseSequence)
    .map((phase) => ({
      allocationType: phase.allocationType || ALLOCATION_TYPE.PERCENT,
      allocationValue: phase.allocationValue ?? '',
      successThreshold: phase.successThreshold ?? '',
      observationHours: phase.waitMinutes ? phase.waitMinutes / 60 : 0,
      deviceIds: (phase.devices || []).map((device) => device.id),
      devices: phase.devices || [],
      // 저장된 그룹의 배정 결과는 자동 분할일 수도 있어 "직접 선택" 표시는 하지 않는다
      manualSelection: false,
      deviceCount: phase.deviceCount,
      phaseStatus: phase.phaseStatus
    }))

// 1단계는 소수의 로봇으로 시작하는 경우가 많아 대수(count), 이후 단계는 비율(%)을 기본값으로 둔다
export const createDefaultStage = (index = 0) => ({
  allocationType: index === 0 ? ALLOCATION_TYPE.COUNT : ALLOCATION_TYPE.PERCENT,
  allocationValue: '',
  successThreshold: '',
  observationHours: MIN_OBSERVATION_HOURS,
  deviceIds: []
})

export { MIN_WAIT_MINUTES }
