import { useEffect, useRef } from 'react'
import useRobotOnline from './useRobotOnline'
import useRobotSetupStatus from './useRobotSetupStatus'
import { ROBOT_ONLINE, LOG_TAG, isNetworkGateBypassed } from '@/utils/networkStatus'
import { SETUP_MODE } from '@/utils/setupSteps'

/** 로봇이 외부 네트워크에 붙기 전에 가장 먼저 가야 하는 화면. */
export const NETWORK_SETUP_PATH = '/network'

/**
 * 네트워크 설정 우선 게이트.
 *
 * 로그인은 브라우저 → 클라우드 직통이라 로봇이 외부 네트워크에 붙기 전에는 성공할 수 없다.
 * 그래서 로그인 여부와 무관하게 offline 이면 /network 로 먼저 보낸다.
 *
 * 게이트를 걸지 않는 경우:
 * - unknown: Wi-Fi 상태를 못 읽은 것(유선 연결·개발 환경 포함) — 갇히는 쪽이 더 위험하다.
 * - 셋업 완료(status 'completed'): 설치가 끝난 로봇을 Wi-Fi 화면에 가둘 이유가 없다.
 *   (/network 라우트 자체는 설치 단계 밖이라 완료 후에도 남아 있다 — 헤더 Wi-Fi 아이콘으로 들어간다)
 * - 단독 설치(standalone): 외부 네트워크가 없는 현장을 전제로 하는 모드다. 로그인도 하지 않으므로
 *   (utils/session) 오프라인은 정상 상태이고, 게이트를 걸면 설치를 시작할 수조차 없다.
 * - 설치 모드를 아직 고르지 않은 경우: 언어 설정과 모드 선택은 네트워크 없이도 해야 한다 —
 *   네트워크 불가 현장이라 단독 설치를 고르려는 로봇을 Wi-Fi 화면에 가둘 수 없다.
 *   관제 연동을 고르면 그 화면이 바로 Wi-Fi 설정으로 보내고(pages/Default/InstallMode),
 *   그 뒤로는 이 게이트가 다시 동작한다.
 * - 사용자가 명시적으로 우회(utils/networkStatus 의 bypass) 한 경우.
 *
 * @returns {{ loading: boolean, state: 'online'|'offline'|'unknown', blocked: boolean }}
 */
const useNetworkGate = () => {
  const { loading: onlineLoading, state } = useRobotOnline()
  const { loading: setupLoading, completed, mode, setup } = useRobotSetupStatus()

  const loading = onlineLoading || setupLoading
  const bypassed = isNetworkGateBypassed()
  // 모드는 값이 없으면 managed 로 읽히므로(normalizeMode) '아직 고르지 않음' 은 레코드로 판단한다.
  const modeDecided = Boolean(setup?.operationMode)
  const standalone = mode === SETUP_MODE.STANDALONE
  const blocked =
    !loading && state === ROBOT_ONLINE.OFFLINE && !completed && modeDecided && !standalone && !bypassed

  // 판정 결과는 값이 바뀔 때만 남긴다(렌더마다 찍으면 흐름을 읽을 수 없다).
  const lastLogged = useRef(null)
  useEffect(() => {
    if (loading) return
    const line = `${state}/${blocked}/${completed}/${modeDecided}/${standalone}/${bypassed}`
    if (lastLogged.current === line) return
    lastLogged.current = line
    console.info(`${LOG_TAG} gate:`, {
      state,
      blocked,
      setupCompleted: completed,
      modeDecided,
      standalone,
      bypassed
    })
  }, [loading, state, blocked, completed, modeDecided, standalone, bypassed])

  return { loading, state, blocked }
}

export default useNetworkGate
