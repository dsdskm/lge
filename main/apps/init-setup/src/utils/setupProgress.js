import { toast } from 'react-toastify'
import { create, list, update } from '@/apis/robotSetupApis'
import { resetRobotSetupCache } from '@/hooks/useRobotSetupStatus'
import { SETUP_MODE, SETUP_STEP_KEYS, normalizeMode, stepNumberOf, stepOrderFor } from '@/utils/setupSteps'

/**
 * 설치 진행 상태(robot_setups)를 갱신하는 공용 로직.
 *
 * robot_setups 는 '이 로봇의 셋업 설정 1건' 이므로 레코드를 누적하지 않고 최신 1건을 갱신한다
 * (없으면 만든다) — FE 는 어디서나 최신 1건만 읽으므로(hooks/useRobotSetupStatus) 상태가 한 곳에 모인다.
 *
 * 필드 의미:
 * - operationMode: 설치 모드('managed' | 'standalone'). 단계 목록 자체가 이 값으로 갈린다
 *   (utils/setupSteps). 모드는 모드 선택 화면에서 BE 가 기록한다
 *   (POST /default-setup/install-mode — standalone 이면 로컬 위치 계층도 함께 준비된다).
 * - currentStepKey: '지금 작업 중인 단계' 이름. 이 값이 정본이다.
 *   router/routes.jsx 의 getSetupLandingPath 가 착지 화면을, getSetupProgress 가 열림 범위를 계산한다.
 * - currentStep: 같은 단계의 1-based 위치(숫자). 모드마다 목록이 달라 단독으로는 해석할 수 없어
 *   호환용으로만 함께 저장한다.
 * - status: 'draft' = 셋업 진행 중 / 'completed' = 설치 완료.
 *   App.jsx 가 이 값으로 초기 설정 그룹을 헤더 탭·사이드바·라우트에서 감추고,
 *   getSetupProgress 는 단계 순서 잠금을 모두 푼다.
 */
export { SETUP_STEP_KEYS }

/** 최신 robotSetup 1건 (없으면 null). 캐시(useRobotSetupStatus)가 아니라 항상 서버 값을 읽는다. */
const fetchLatest = async () => {
  const response = await list({ limit: 1 })
  return response?.data?.[0] || null
}

/** 조회해 둔 최신 1건을 갱신하거나(없으면) 새로 만든다. 성공 시 앱 진입 캐시를 비운다. */
const saveOn = async (latest, fields) => {
  const saved = latest?.id ? await update(latest.id, fields) : await create(fields)
  resetRobotSetupCache()
  return saved
}

/**
 * 단계 이름을 그 레코드의 모드 기준 숫자와 함께 담는다.
 * 저장하는 쪽에서만 숫자를 만든다 — 읽는 쪽은 이름만 본다.
 */
const stepFields = (setup, stepKey) => ({
  currentStepKey: stepKey,
  currentStep: stepNumberOf(setup?.operationMode, stepKey) || null
})

/**
 * 작업 중인 단계를 옮긴다 (status 는 'draft' 유지).
 *
 * 이미 전역 완료(status 'completed')인 로봇은 건드리지 않는다 — 설치를 끝낸 뒤 맵을 다시 스캔하는
 * 경우가 있는데, 그때 draft 로 되돌리면 완료 이력이 사라져 초기 설정 메뉴가 다시 나타나고
 * 뒷 단계가 잠긴다.
 *
 * @param {string} stepKey SETUP_STEP_KEYS 값
 * @returns {Promise<{skipped: boolean}>} skipped: 이미 완료된 셋업이라 기록하지 않음
 */
export const advanceSetupProgress = async (stepKey) => {
  const latest = await fetchLatest()
  if (latest?.status === 'completed') return { skipped: true }

  await saveOn(latest, { status: 'draft', ...stepFields(latest, stepKey) })
  return { skipped: false }
}

/**
 * advanceSetupProgress 의 '실패해도 흐름을 막지 않는' 버전.
 *
 * 단계 완료 기록은 이미 끝난 작업(맵 저장 · POI 저장)의 후처리라서, 실패를 화면 흐름으로 올리면
 * 정작 성공한 저장이 실패처럼 보인다. 그래서 토스트로만 알린다.
 *
 * @param {string} stepKey SETUP_STEP_KEYS 값
 */
export const tryAdvanceSetupProgress = async (stepKey) => {
  try {
    await advanceSetupProgress(stepKey)
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.message || 'Request failed'
    toast.warn(`Setup progress not saved: ${message}`, { autoClose: 4000 })
  }
}

/**
 * '이 단계를 끝냈다' 를 기록한다 — 다음 단계가 무엇인지는 모드별 단계 순서에서 찾는다.
 *
 * 맵 스캔/시맨틱처럼 두 모드에 모두 있는 단계라도 그 '다음' 은 모드에 따라 다르다
 * (시맨틱 다음 = 관제 연동: 업로드 / 단독: 설치 완료). 호출부가 모드를 알 필요가 없도록
 * 여기서 최신 레코드의 모드로 계산한다. 마지막 단계였으면 그 자리에 머문다.
 *
 * advanceSetupProgress 와 같은 이유로 실패를 흐름으로 올리지 않는다(토스트만).
 *
 * @param {string} doneStepKey 방금 끝낸 단계 (SETUP_STEP_KEYS 값)
 */
export const tryAdvanceAfter = async (doneStepKey) => {
  try {
    const latest = await fetchLatest()
    if (latest?.status === 'completed') return

    const order = stepOrderFor(latest?.operationMode)
    const next = order[order.indexOf(doneStepKey) + 1] || doneStepKey
    await saveOn(latest, { status: 'draft', ...stepFields(latest, next) })
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.message || 'Request failed'
    toast.warn(`Setup progress not saved: ${message}`, { autoClose: 4000 })
  }
}

/**
 * 초기 설정 완료 처리 — 관제 연동 설치의 약관 동의 '완료' 에서 호출한다.
 *
 * status 를 'completed' 로 올리는 것이 헤더에서 초기 설정 탭을 감추는 값이다(App.jsx setupCompleted:
 * headerRoutes / visibleAppRoutes 가 SETUP_GROUP.INITIAL 을 제거한다). 작업 중인 단계는 다음 단계인
 * 맵 스캔으로 옮긴다.
 *
 * 이 상태는 단계 순서 잠금도 함께 푼다(router/routes.jsx getSetupProgress).
 */
export const completeInitialSetup = async () => {
  const latest = await fetchLatest()
  return saveOn(latest, { status: 'completed', ...stepFields(latest, SETUP_STEP_KEYS.MAP_SCAN) })
}

/**
 * 셋업 전역 완료 처리 — 마지막 단계(관제 연동: 업로드 / 단독: 설치 완료)에서 호출한다.
 * 관제 연동에서는 초기 설정 완료로 이미 'completed' 이므로 작업 단계를 마지막으로 확정하는 의미다.
 */
export const completeSetup = async () => {
  const latest = await fetchLatest()
  const lastStep =
    normalizeMode(latest?.operationMode) === SETUP_MODE.STANDALONE
      ? SETUP_STEP_KEYS.FINISH
      : SETUP_STEP_KEYS.UPLOAD
  return saveOn(latest, { status: 'completed', ...stepFields(latest, lastStep) })
}

/** 셋업 조회 캐시를 비운다 — 모드 선택처럼 BE 가 직접 robot_setups 를 바꾼 뒤에 쓴다. */
export const refreshSetupCache = () => resetRobotSetupCache()
