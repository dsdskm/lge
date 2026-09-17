import { useEffect, useState } from 'react'
import { list } from '@/apis/robotSetupApis'
import { SETUP_MODE, normalizeMode } from '@/utils/setupSteps'

// 셋업 진행 상태는 앱 진입 시 한 번만 확인한다.
// App 이 이 값 하나로 탭/사이드바/라우트 구성 · 단계 잠금 · 착지 경로(currentStep 이 가리키는
// 작업 중인 단계)를 모두 계산하므로, 모듈 레벨에 Promise 를 캐시해 요청을 1회로 묶는다.
let setupPromise = null

/**
 * 가장 최근 robotSetup 1건 (BE: GET /api/v1/robot-setups → createdAt DESC).
 * 조회 실패나 레코드 없음은 null 로 돌려준다 — 호출부는 '초기 설정 미완료' 로 취급한다
 * (초기 설정을 감추거나 건너뛰게 하는 쪽이 더 위험하다).
 * @returns {Promise<object|null>}
 */
export const fetchRobotSetup = () => {
  if (!setupPromise) {
    setupPromise = list({ limit: 1 })
      .then((res) => res?.data?.[0] || null)
      .catch((error) => {
        console.error('Failed to load robot setup status:', error)
        return null
      })
  }
  return setupPromise
}

/** 캐시 무효화 (초기 설정을 완료 처리한 직후 등). */
export const resetRobotSetupCache = () => {
  setupPromise = null
}

/**
 * @returns {{ loading: boolean, completed: boolean, mode: 'managed'|'standalone', setup: object|null }}
 *   mode: 설치 모드. 레코드가 없거나 값이 없으면 기존 동작인 관제 연동(managed)으로 본다
 *   (utils/setupSteps.normalizeMode) — 단독 설치로 잘못 보면 관제 화면이 사라진다.
 */
const useRobotSetupStatus = () => {
  const [state, setState] = useState({
    loading: true,
    completed: false,
    mode: SETUP_MODE.MANAGED,
    setup: null
  })

  useEffect(() => {
    let alive = true
    fetchRobotSetup().then((setup) => {
      if (alive) {
        setState({
          loading: false,
          completed: setup?.status === 'completed',
          mode: normalizeMode(setup?.operationMode),
          setup
        })
      }
    })
    return () => {
      alive = false
    }
  }, [])

  return state
}

export default useRobotSetupStatus
