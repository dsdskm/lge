import { useUserStore } from '@repo/stores'
import { USER_ROLE_LEVEL } from '@repo/constants'
import { validateSessionViaRobot, refreshSessionViaRobot } from '@/apis/dmApis'
import { fetchRobotSetup } from '@/hooks/useRobotSetupStatus'
import { SETUP_MODE, normalizeMode } from '@/utils/setupSteps'

export const LOG_TAG = '[session-gate]'

/**
 * 세션 만료로 로그인 화면에 도착했음을 알리는 기존 규약.
 * @repo/hooks 의 useLogin 이 이 쿼리를 보고 'session out' 토스트(login:logoutForSession)를 띄운다.
 * robotClient 의 401 강제 로그아웃도 같은 경로를 쓴다 — 여기서도 재사용해 문구/동작을 한 곳에 둔다.
 */
export const SESSION_OUT_LOGIN_PATH = '/login?sessionout=Y'

/**
 * 세션 확인 결과.
 * - VALID: 그대로 화면을 열어도 된다 (갱신에 성공한 경우 포함)
 * - EXPIRED: 갱신까지 실패 — 로그인 화면으로 되돌려야 한다
 * - UNKNOWN: 판정 불가(로봇 BE 미응답 등) — 막지 않는다. 갇히는 쪽이 더 위험하다.
 */
export const SESSION_STATE = {
  VALID: 'valid',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown'
}

/**
 * 같은 판정을 화면 이동마다 되풀이하지 않기 위한 유효 기간.
 * 세션 확인은 로봇 BE → 클라우드 왕복이라 사이드바를 몇 번 누르는 동안 매번 걸면 체감이 나쁘다.
 * 이 시간 안에 이미 유효로 확인된 accessToken 이면 다시 묻지 않는다 — 그 사이 토큰이 죽어도
 * 실제 API 호출이 401 로 걸러 주므로 안전하다.
 */
const VALID_CACHE_MS = 30_000

// 마지막으로 유효하다고 확인한 accessToken 과 시각.
let lastValid = { token: null, at: 0 }
// 화면 진입이 겹칠 때(리마운트·중첩 렌더) 같은 확인을 동시에 두 번 보내지 않는다.
let inFlight = null

const isFreshlyValidated = (accessToken) =>
  lastValid.token === accessToken && Date.now() - lastValid.at < VALID_CACHE_MS

const markValid = (accessToken) => {
  lastValid = { token: accessToken, at: Date.now() }
}

/** 로봇 BE 에 닿지도 못한 실패인지. 이 경우는 토큰 문제가 아니므로 만료로 단정하지 않는다. */
const isInconclusiveFailure = (error) => {
  const status = error?.response?.status
  // 응답 자체가 없다 = fetch 실패(로봇 BE 다운/네트워크 단절).
  // 400 = BE 가 userId/accessToken 을 못 받았다는 뜻(필수 파라미터 누락, utils/ApiError.js).
  //       원격 콘솔(robot-proxy) 경유 진입에서 Authorization 헤더가 BE 까지 닿지 않는 경우가 여기다.
  //       만료된 토큰은 BE 가 200 { valid:false } 로 답하므로 400 은 절대 만료 신호가 아니다 —
  //       전달 문제로 사용자를 로그아웃시키지 않는다.
  // 503 = init-setup-be 가 '클라우드에 못 닿음/설정 누락' 에만 쓰는 코드 (services/cloudHttp.js).
  return status === undefined || status === 400 || status === 503
}

/**
 * 단독 설치(standalone)의 로컬 세션.
 *
 * 로그인은 브라우저 → (로봇 BE 경유) → 클라우드 인증이라 폐쇄망에서는 성립하지 않는다. 그런데
 * 세션이 없으면 RootGuard/SessionGuard 가 모든 화면을 '/login' 으로 되돌리므로(아래 ensureSession
 * 이 토큰 없음을 만료로 취급한다) 단독 설치는 시작조차 할 수 없다.
 *
 * 그래서 세션을 없애는 대신 로컬 세션을 만들어 넣는다 — 화면들이 session.userLevel 로 권한을
 * 판단하고(App.jsx admin 탭) 값이 비면 그 기능만 조용히 사라지기 때문이다. accessToken 은
 * 클라우드로 나가지 않는다(standalone 에서는 클라우드 호출 자체가 BE 에서 409 로 막힌다 —
 * init-setup-be defaultSetup.service.assertManagedMode).
 */
const LOCAL_SESSION = {
  email: 'local@robot',
  userId: 'local-operator',
  userRole: 'SYSTEM_ADMIN',
  userLevel: USER_ROLE_LEVEL.SYSTEM_ADMIN,
  accessToken: 'local-standalone-session'
}

const ensureLocalSession = () => {
  const session = useUserStore.getState().session
  if (session?.accessToken === LOCAL_SESSION.accessToken) return
  console.info(`${LOG_TAG} standalone — using local session`)
  useUserStore.getState().login({ ...LOCAL_SESSION })
}

/**
 * 로컬 세션이 남아 있으면 비운다 — 관제 연동으로 전환할 때 쓴다(pages/Migration).
 *
 * 로컬 세션은 클라우드가 모르는 토큰이고 권한도 최고 레벨로 박혀 있다. 전환 뒤에는 실제 로그인으로
 * 대체되어야 하므로, 모드를 올리는 시점에 지워 로그인 화면을 거치게 한다.
 * @returns {boolean} 지웠는지
 */
export const clearLocalSession = () => {
  const session = useUserStore.getState().session
  if (session?.accessToken !== LOCAL_SESSION.accessToken) return false
  lastValid = { token: null, at: 0 }
  useUserStore.getState().logout()
  return true
}

/** 단독 설치인지. 셋업 조회 실패는 관제 연동으로 본다(기존 동작이 기본값이다). */
const isStandalone = async () => {
  const setup = await fetchRobotSetup()
  return normalizeMode(setup?.operationMode) === SETUP_MODE.STANDALONE
}

/**
 * 세션을 확인하고, 만료면 refreshToken 으로 한 번 갱신한다.
 *
 * 로그인과 같은 이유로 확인·갱신 모두 로봇 BE 를 경유한다 — 노트북/폰이 로봇 setup AP 에 붙어
 * 있으면 브라우저는 클라우드로 직접 나갈 수 없다(apis/dmApis.js 주석 참고).
 *
 * @returns {Promise<'valid'|'expired'|'unknown'>}
 */
export const ensureSession = async () => {
  // 단독 설치는 클라우드 인증이 없다 — 로컬 세션을 채우고 그대로 통과시킨다.
  if (await isStandalone()) {
    ensureLocalSession()
    return SESSION_STATE.VALID
  }

  const session = useUserStore.getState().session
  const { accessToken, refreshToken, userId } = session || {}

  // 애초에 로그인하지 않은 상태 — 만료와 같이 취급해 로그인 화면으로 보낸다.
  if (!accessToken || !userId) return SESSION_STATE.EXPIRED

  if (isFreshlyValidated(accessToken)) return SESSION_STATE.VALID
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const { valid } = await validateSessionViaRobot(userId, accessToken)
      if (valid) {
        markValid(accessToken)
        return SESSION_STATE.VALID
      }
    } catch (error) {
      if (isInconclusiveFailure(error)) {
        console.warn(`${LOG_TAG} session check inconclusive — not blocking:`, error.message)
        return SESSION_STATE.UNKNOWN
      }
      console.warn(`${LOG_TAG} session check failed:`, error.message)
    }

    if (!refreshToken) {
      console.info(`${LOG_TAG} session expired and no refreshToken — login required`)
      return SESSION_STATE.EXPIRED
    }

    try {
      // 만료된 accessToken 도 함께 넘긴다 — 클라우드 갱신 API 가 Authorization 을 요구한다.
      const refreshed = await refreshSessionViaRobot(userId, refreshToken, accessToken)
      if (!refreshed?.accessToken) {
        console.info(`${LOG_TAG} token refresh returned no accessToken — login required`)
        return SESSION_STATE.EXPIRED
      }
      // refreshToken 을 새로 주지 않는 배포도 있으므로 없으면 기존 값을 유지한다.
      useUserStore.getState().updateTokens({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || refreshToken
      })
      markValid(refreshed.accessToken)
      console.info(`${LOG_TAG} token refreshed`)
      return SESSION_STATE.VALID
    } catch (error) {
      if (isInconclusiveFailure(error)) {
        console.warn(`${LOG_TAG} token refresh inconclusive — not blocking:`, error.message)
        return SESSION_STATE.UNKNOWN
      }
      console.info(`${LOG_TAG} token refresh rejected — login required:`, error.message)
      return SESSION_STATE.EXPIRED
    }
  })().finally(() => {
    inFlight = null
  })

  return inFlight
}

/** 세션이 만료됐을 때 상태를 비우고 로그인 화면 경로를 돌려준다. */
export const clearSessionForLogin = () => {
  lastValid = { token: null, at: 0 }
  useUserStore.getState().logout()
  return SESSION_OUT_LOGIN_PATH
}
