import Map from '@/pages/Map'
import Semantic from '@/pages/Map/Semantic'
import Language from '@/pages/Default/Language'
import Network from '@/pages/Default/Network'
import InstallMode from '@/pages/Default/InstallMode'
import SiteCode from '@/pages/Default/SiteCode'
import RobotInfo from '@/pages/Default/RobotInfo'
import Location from '@/pages/Default/Location'
import LocalPlace from '@/pages/Default/LocalPlace'
import Terms from '@/pages/Default/Terms'
import Download from '@/pages/Download'
import Upload from '@/pages/Upload'
import Finish from '@/pages/Finish'
import Migration from '@/pages/Migration'
import Login from '@/pages/Login'
import Admin from '@/pages/Admin'
import Version from '@/pages/Version'
import RootGuard from '@/components/RootGuard'
import AdminGuard from '@/components/AdminGuard'
import NetworkGuard from '@/components/NetworkGuard'
import MapGroupIndex from '@/components/MapGroupIndex'
import { SETUP_MODE, mapGroupLanding, normalizeMode, stepKeyAt, stepOrderFor } from '@/utils/setupSteps'
// 공용 아이콘 세트(@repo/ui Icon)에 wifi 가 없어 앱 자산을 컴포넌트로 넘긴다 — GnbButton 은
// 문자열(공용 세트 조회) 과 컴포넌트를 모두 받는다. 헤더의 Wi-Fi 아이콘과 같은 자산을 쓴다.
import SvgWifi from '@/assets/wifi.svg'
import { USER_ROLE_LEVEL } from '@repo/constants'

// 사이드바 메뉴는 세 그룹으로 나뉘고, 헤더 탭이 그룹을 전환한다.
// - initialSetup: 언어 설정 ~ 서비스 이용약관 (로봇 최초 설치 단계)
// - mapSetup: 지도 ~ 업로드 (맵 스캔/시맨틱/업로드 단계)
// - admin: DB 데이터 브라우저. 사이드바 항목은 고정 목록이 아니라 GET /admin/schema 로 받은
//   테이블 목록이라 App 에서 런타임에 만든다 (여기서는 라우트만 정의).
// robotSetup.status === 'completed'(= 마지막 단계인 업로드까지 끝낸 전역 완료)이면 initialSetup 그룹은
// 탭/사이드바/라우트에서 모두 제거되고(App.jsx) 단계 순서 잠금도 풀린다.
// 그 전에는 currentStep(작업 중인 단계)까지만 열린다 — 아래 getSetupProgress.
//
// network 는 설치 단계가 아니라 '언제든 열 수 있는 Wi-Fi 설정' 이라 위 세 그룹 밖의 전용 그룹이다
// (헤더 탭이 없는 그룹 — CustomHeader · 로그인 화면의 Wi-Fi 아이콘으로 들어온다).
export const SETUP_GROUP = {
  INITIAL: 'initialSetup',
  MAP: 'mapSetup',
  ADMIN: 'admin',
  NETWORK: 'network'
}

/**
 * 헤더 탭. 맵 설정 탭이 가리키는 경로가 모드에 따라 다르므로 함수로 만든다.
 * @param {'managed'|'standalone'} [mode]
 */
export const headerGnbFor = (mode) => [
  { name: SETUP_GROUP.INITIAL, path: '/language', prefix: '', group: SETUP_GROUP.INITIAL },
  { name: SETUP_GROUP.MAP, path: mapGroupLanding(mode), prefix: '', group: SETUP_GROUP.MAP },
  // admin 탭은 SYSTEM_MANAGER 이상만 본다 (라우트 접근 제한은 AdminGuard 가 담당).
  {
    name: SETUP_GROUP.ADMIN,
    path: '/admin',
    prefix: '',
    group: SETUP_GROUP.ADMIN,
    minUserLevel: USER_ROLE_LEVEL.SYSTEM_MANAGER
  }
]

/**
 * 기본 헤더 탭(관제 연동 기준). 모드를 모르는 자리의 기본값으로만 쓴다
 * (components/CustomHeader 의 props 기본값) — App 은 모드를 아는 headerGnbFor 를 쓴다.
 */
export const HEADER_GNB = headerGnbFor(SETUP_MODE.MANAGED)

export const appRoutes = [
  {
    name: 'language',
    path: '/language',
    prefix: '',
    icon: 'language',
    group: SETUP_GROUP.INITIAL,
    element: <Language />
  },
  {
    // 설치 모드 선택(관제 연동 / 단독). 이 화면에서 정한 값이 뒤 단계 목록 자체를 바꾼다
    // (utils/setupSteps STEP_ORDER, 아래 modes 필터).
    // 언어 다음에 두는 이유: 모드 설명을 읽어야 고를 수 있는 선택이라 언어보다 뒤여야 한다.
    name: 'installMode',
    path: '/install-mode',
    prefix: '',
    icon: 'settings',
    group: SETUP_GROUP.INITIAL,
    element: <InstallMode />
  },
  {
    // Wi-Fi 설정. 설치 단계(초기 설정 그룹)에서 빼고 헤더 · 로그인 화면의 Wi-Fi 아이콘으로 들어온다.
    // group 을 SETUP_GROUP.NETWORK(헤더 탭이 없는 전용 그룹)로 둔 이유:
    // - 초기 설정 그룹에 넣으면 단계 번호(currentStep)에 끼어들고, 셋업 완료 시 그룹째로 라우트에서
    //   제거돼(App.jsx) Wi-Fi 를 다시 바꿀 수 없다.
    // - 사이드바는 현재 화면이 속한 그룹만 보여주므로(Router LayoutShell) 이 화면에서는 이 항목
    //   하나만 뜨고, 다른 화면의 사이드바에는 나타나지 않는다.
    name: 'network',
    path: '/network',
    prefix: '',
    icon: SvgWifi,
    group: SETUP_GROUP.NETWORK,
    element: <Network />
  },
  {
    name: 'siteCode',
    path: '/site-code',
    prefix: '',
    icon: 'site_management',
    group: SETUP_GROUP.INITIAL,
    modes: [SETUP_MODE.MANAGED],
    element: <SiteCode />
  },
  {
    name: 'location',
    path: '/location',
    prefix: '',
    icon: 'location',
    group: SETUP_GROUP.INITIAL,
    modes: [SETUP_MODE.MANAGED],
    element: <Location />
  },
  {
    name: 'robotInfo',
    path: '/robot-info',
    prefix: '',
    icon: 'robot',
    group: SETUP_GROUP.INITIAL,
    modes: [SETUP_MODE.MANAGED],
    element: <RobotInfo />
  },
  {
    // 단독 설치의 위치 계층 화면. 관제에서 건물/층/구역을 받을 수 없으므로 로컬 계층을 여기서
    // 손본다(모드 선택 시 BE 가 만들어 둔 Local/1F/Default 를 이름 변경 · 층/구역 추가로 넓힌다).
    // 맵은 구역 단위로 저장되므로(pages/Map) 층/구역을 추가하지 않으면 맵을 한 장만 만들 수 있다.
    name: 'localPlace',
    path: '/local-place',
    prefix: '',
    icon: 'location',
    group: SETUP_GROUP.INITIAL,
    modes: [SETUP_MODE.STANDALONE],
    element: <LocalPlace />
  },
  {
    name: 'terms',
    path: '/terms',
    prefix: '',
    icon: 'policy',
    group: SETUP_GROUP.INITIAL,
    modes: [SETUP_MODE.MANAGED],
    // TODO: 약관 적용 시 다시 노출. 현재는 기능/라우트는 유지하고 메뉴에서만 숨긴다.
    hide: true,
    element: <Terms />
  },
  {
    name: 'download',
    path: '/download',
    prefix: '',
    icon: 'download',
    group: SETUP_GROUP.MAP,
    modes: [SETUP_MODE.MANAGED],
    element: <Download />
  },
  {
    name: 'map',
    prefix: '',
    icon: 'map',
    group: SETUP_GROUP.MAP,
    depth: [
      {
        name: 'scan',
        path: '/map/scan',
        prefix: '',
        element: <Map />
      },
      {
        name: 'semantic',
        path: '/map/semantic',
        prefix: '',
        element: <Semantic />
      }
    ]
  },
  {
    // '/map' 자체는 화면이 없는 부모 메뉴다(위 depth 만 라우트를 갖는다) — 직접 진입하면 '*' 로
    // 떨어져 진행 중인 단계로 튕기므로, 맵 설정 그룹의 첫 화면인 다운로드로 보낸다.
    //
    // 이 항목은 맵 설정 그룹(SETUP_GROUP.MAP)에 넣지 않는다 — group 이 붙으면 설치 단계 목록
    // (SETUP_STEP_ROUTES)에 끼어 단계 번호(currentStep)가 한 칸씩 밀린다.
    // 순서도 '/map' 하위 라우트들 뒤여야 한다 — getRouteGroup 은 앞에서부터 접두사 일치로 찾으므로
    // 앞에 두면 '/map/scan' 의 그룹까지 이 항목이 가로채 헤더 탭·사이드바가 비어 보인다.
    name: 'mapIndex',
    path: '/map',
    prefix: '',
    hide: true,
    hideLayout: true,
    // 착지점이 모드에 따라 다르므로(mapGroupLanding) 정적 Navigate 대신 모드를 읽는 컴포넌트를 쓴다.
    element: <MapGroupIndex />
  },
  {
    name: 'login',
    path: '/login',
    prefix: '',
    icon: 'publish',
    hide: true,
    hideLayout: true,
    // 단독 설치에는 로그인이 없다(클라우드 인증을 쓰지 않고 로컬 세션으로 대체한다 — utils/session).
    // 라우트를 지우면 401 리다이렉트 같은 잔여 진입도 Router 의 catch-all 이 진행 중 단계로 돌린다.
    modes: [SETUP_MODE.MANAGED],
    // 로그인은 브라우저 → 클라우드 직통이라 로봇이 외부 네트워크에 붙기 전에는 성공할 수 없다.
    // URL 직접 진입 · 401 인터셉터(window.location.href = '/login')로 들어오는 경우까지
    // NetworkGuard 가 /network 로 되돌린다.
    element: (
      <NetworkGuard>
        <Login />
      </NetworkGuard>
    )
  },
  {
    name: 'upload',
    path: '/upload',
    prefix: '',
    icon: 'publish',
    group: SETUP_GROUP.MAP,
    modes: [SETUP_MODE.MANAGED],
    element: <Upload />
  },
  {
    // 단독 설치의 마지막 단계. 업로드가 없으므로 완료 처리(robotSetup.status = 'completed')와
    // 로컬 확정(POI 확정 + 작업본 맵 승격)을 이 화면이 맡는다 — pages/Finish 주석 참고.
    name: 'finish',
    path: '/finish',
    prefix: '',
    icon: 'publish',
    group: SETUP_GROUP.MAP,
    modes: [SETUP_MODE.STANDALONE],
    element: <Finish />
  },
  {
    // 단독 설치 → 관제 연동 전환. 단계(step) 목록에는 넣지 않는다 — 설치를 마친 뒤에 하는 별도
    // 작업이고, 단계에 끼우면 진행 단계 번호가 모드별로 또 갈린다.
    //
    // modes 를 두지 않는 이유: 전환은 모드를 managed 로 올린 뒤에도 계속 진행되므로(맵 재매핑 ·
    // 로컬 계층 정리) 단독 전용으로 두면 전환을 시작한 순간 화면이 사라진다.
    // 대신 사이드바 노출은 App.jsx 가 전환 상태(hooks/useMigration)로 정한다 — 단독 설치를 거치지
    // 않은 로봇에는 이 항목이 뜨지 않아야 한다.
    name: 'migration',
    path: '/migration',
    prefix: '',
    icon: 'site_management',
    group: SETUP_GROUP.MAP,
    hide: true,
    element: <Migration />
  },
  {
    // DB 데이터 브라우저. hide: true — 사이드바 항목은 이 라우트가 아니라 스키마 목록으로 그린다.
    // 접근 권한 제한은 AdminGuard 가 담당.
    name: 'admin',
    path: '/admin',
    prefix: '',
    icon: 'settings',
    hide: true,
    group: SETUP_GROUP.ADMIN,
    element: (
      <AdminGuard>
        <Admin />
      </AdminGuard>
    )
  },
  {
    // 버전 확인용 진단 페이지. group 없음 + hide: true 로 헤더 탭/사이드바에서 빠지고,
    // hideLayout: true 라 설치 단계 게이트(SetupOrderModal)도 타지 않는다 — 셋업 진행 중에도
    // URL 직접 진입으로 열 수 있다.
    name: 'version',
    path: '/version',
    prefix: '',
    hide: true,
    hideLayout: true,
    element: <Version />
  },
  {
    // /admin/:resource — 사이드바에서 선택한 테이블. 화면은 /admin 과 같다.
    name: 'adminResource',
    path: '/admin/:resource',
    prefix: '',
    hide: true,
    group: SETUP_GROUP.ADMIN,
    element: (
      <AdminGuard>
        <Admin />
      </AdminGuard>
    )
  }
]
export const getAppPrefix = (pathname) => {
  return pathname.split('/').filter(Boolean)[0] || ''
}

/**
 * @param {object[]} routes 트리 형태의 라우트 목록
 * @param {React.ReactNode} [rootElement] '/' 에 붙일 엘리먼트.
 *   App 은 셋업 진행 상태를 알고 있으므로 착지 경로를 주입한 RootGuard 를 넘긴다.
 */
export const flattenRoutes = (routes, rootElement = <RootGuard />) => {
  // 하위 메뉴(depth)는 부모의 group 을 물려받는다 — 헤더 탭 / 사이드바 필터가 group 으로 동작하므로
  // /map/scan 같은 자식 경로에서도 소속 그룹을 알 수 있어야 한다.
  const flatten = (items, parentGroup) =>
    items.reduce((acc, route) => {
      const { depth, ...rest } = route
      const group = rest.group ?? parentGroup
      acc.push({ ...rest, ...(group && { group }) })
      return depth ? [...acc, ...flatten(depth, group)] : acc
    }, [])

  return [...flatten(routes), { name: '', path: '/', prefix: '', hideLayout: true, element: rootElement }]
}

/** 라우트를 한 번만 펼쳐 재사용한다 (단계 순서 계산 · 그룹 판별 공용). */
export const FLAT_APP_ROUTES = flattenRoutes(appRoutes)

/**
 * 이 라우트가 해당 설치 모드에서 쓰이는지. modes 가 없으면 모든 모드 공용이다.
 * 메뉴·라우트 노출(App.jsx)과 단계 목록 계산이 같은 기준을 쓰도록 한 곳에 둔다.
 */
export const routeAllowsMode = (route, mode) => !route.modes || route.modes.includes(normalizeMode(mode))

const stepRoutesOf = (group, mode) =>
  FLAT_APP_ROUTES.filter((route) => route.group === group && route.path && routeAllowsMode(route, mode))

/**
 * 모드별 설치 단계 순서. 초기 설정 다음에 맵 설정이 온다.
 * 모드마다 목록이 다르므로(단독 설치는 사이트 코드 · 다운로드 · 업로드가 없다) 모드별로 캐시한다.
 */
const STEP_ROUTES_BY_MODE = Object.fromEntries(
  Object.values(SETUP_MODE).map((mode) => {
    const initial = stepRoutesOf(SETUP_GROUP.INITIAL, mode)
    const map = stepRoutesOf(SETUP_GROUP.MAP, mode)
    return [mode, { initial, map, all: [...initial, ...map] }]
  })
)

// 단계 순서는 여기(라우트 나열 순서)와 utils/setupSteps(STEP_ORDER) 두 곳에 있다 — 서로를 직접
// 참조하면 순환 import 가 되어(routes → pages → setupProgress → setupSteps) 값을 각자 갖는다.
// 어긋나면 저장되는 단계 번호와 화면 순서가 달라지므로 진입 시 한 번 비교해 경고를 남긴다.
if (import.meta.env.DEV) {
  for (const mode of Object.values(SETUP_MODE)) {
    const fromRoutes = STEP_ROUTES_BY_MODE[mode].all.map((route) => route.name).join(',')
    const fromKeys = stepOrderFor(mode).join(',')
    if (fromRoutes !== fromKeys) {
      console.warn(
        `[routes] setup step order mismatch for '${mode}':\n  routes: ${fromRoutes}\n  keys  : ${fromKeys}`
      )
    }
  }
}

/** 해당 모드의 단계 라우트 목록. */
export const setupStepRoutes = (mode) => STEP_ROUTES_BY_MODE[normalizeMode(mode)].all
/** 해당 모드의 맵 설정 단계 라우트 목록(맵 그룹 착지 계산용). */
export const mapStepRoutes = (mode) => STEP_ROUTES_BY_MODE[normalizeMode(mode)].map

const NO_LOCKED_PATHS = new Set()

/**
 * 저장된 진행 상태를 그 모드의 단계 목록 위치(0-based)로 읽는다.
 * currentStepKey(이름)가 정본이고, 없으면(구버전 레코드) currentStep(숫자)으로 되돌려 읽는다.
 * 둘 다 없거나 그 모드에 없는 단계면 첫 단계로 본다 — 뒤 단계를 건너뛰게 만드는 것보다 안전하다.
 */
const stepIndexOf = (setup, steps) => {
  const mode = normalizeMode(setup?.operationMode)
  const key = setup?.currentStepKey || stepKeyAt(mode, setup?.currentStep)
  const index = steps.findIndex((route) => route.name === key)
  return index >= 0 ? index : 0
}

/**
 * 단계 진행 상태. 진행 중인 단계까지는 열려 있고(=이미 지난 단계로 되돌아가기 허용) 그 뒤는 잠긴다.
 * @param {object|null} setup robotSetup 레코드 (operationMode · currentStepKey 를 읽는다)
 * @param {{completed?: boolean, enforce?: boolean}} [options]
 *   completed: 셋업 완료(전부 허용) / enforce: false 면 순서 강제를 끈다
 * @returns {{ pendingStep: object|null, lockedPaths: Set<string> }}
 *   pendingStep: 지금 진행해야 할 단계 (잠긴 단계를 눌렀을 때 안내할 목적지)
 */
export const getSetupProgress = (setup, { completed = false, enforce = true } = {}) => {
  if (completed || !enforce) {
    return { pendingStep: null, lockedPaths: NO_LOCKED_PATHS }
  }
  const steps = setupStepRoutes(setup?.operationMode)
  const index = stepIndexOf(setup, steps)
  return {
    pendingStep: steps[index] || steps[0],
    lockedPaths: new Set(steps.slice(index + 1).map((route) => route.path))
  }
}

/**
 * 앱 진입 시 착지할 경로. 저장된 진행 단계(currentStepKey)의 화면으로 바로 보낸다.
 * - 셋업 완료: 초기 설정 그룹이 제거되므로 맵 설정 첫 화면
 * - 진행 단계 없음/비정상: 첫 단계
 * 순서 강제(enforce) 여부와 무관하게 같은 경로를 쓴다 — 강제를 꺼도 진행 중 단계에서 이어받는 게 맞다.
 * @param {object|null} setup robotSetup 레코드
 * @param {{completed?: boolean}} [options]
 * @returns {string|undefined}
 */
export const getSetupLandingPath = (setup, { completed = false } = {}) => {
  if (completed) return mapStepRoutes(setup?.operationMode)[0]?.path
  const steps = setupStepRoutes(setup?.operationMode)
  return steps[stepIndexOf(setup, steps)]?.path
}

/** pathname 이 속한 그룹을 찾는다 (플랫하게 펼친 라우트 기준). */
export const getRouteGroup = (routes, pathname) => {
  const match = routes.find(
    ({ path }) => path && path !== '/' && (pathname === path || pathname.startsWith(`${path}/`))
  )
  return match?.group
}
