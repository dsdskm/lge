/**
 * 설치 모드와 단계(스텝) 이름 — 라우트/진행상태 양쪽이 공유하는 최소 상수 모듈.
 *
 * 이 모듈은 아무것도 import 하지 않는다. router/routes.jsx 와 utils/setupProgress.js 가 모두
 * 여기에 의존하는데(routes → pages → setupProgress → routes 로 순환이 생기므로 서로를 직접
 * 참조할 수 없다), 단계 순서를 두 곳에 손으로 적어 두면 한쪽만 고쳐져 단계가 어긋난다.
 *
 * 단계는 '이름' 이 정본이다. 기존 robot_setups.currentStep(숫자)은 목록의 1-based 위치라서
 * 모드마다 목록 길이가 달라 같은 숫자가 다른 단계를 가리킨다 — 숫자는 호환을 위해 함께 저장만 한다
 * (utils/setupProgress.advanceSetupProgress).
 *
 * 이름은 라우트 name 과 같아야 한다(router/routes.jsx) — routes.jsx 가 진입 시 순서를 비교해
 * 어긋나면 콘솔에 경고를 남긴다.
 */

/** 설치 모드. standalone = 네트워크 불가 현장용 단독 설치(관제 연동 없음). */
export const SETUP_MODE = {
  MANAGED: 'managed',
  STANDALONE: 'standalone'
}

/** 값이 무엇이든 유효한 모드로 좁힌다 — 알 수 없으면 기존 동작인 관제 연동으로 본다. */
export const normalizeMode = (mode) => (mode === SETUP_MODE.STANDALONE ? SETUP_MODE.STANDALONE : SETUP_MODE.MANAGED)

/** 단계 이름. 각 화면이 '다음 단계' 를 기록할 때 쓴다. */
export const SETUP_STEP_KEYS = {
  LANGUAGE: 'language',
  INSTALL_MODE: 'installMode',
  SITE_CODE: 'siteCode',
  LOCATION: 'location',
  ROBOT_INFO: 'robotInfo',
  LOCAL_PLACE: 'localPlace',
  TERMS: 'terms',
  DOWNLOAD: 'download',
  MAP_SCAN: 'scan',
  MAP_SEMANTIC: 'semantic',
  UPLOAD: 'upload',
  FINISH: 'finish'
}

/**
 * 모드별 단계 순서. 초기 설정 → 맵 설정 순이고, router/routes.jsx 의 라우트 나열 순서와 같다.
 *
 * managed 는 기존 순서에 모드 선택(installMode)만 끼어든다.
 * standalone 은 관제가 필요한 단계(사이트 코드 · 운영 위치 · 로봇명 등록 · 다운로드 · 업로드)가
 * 빠지고, 위치 계층을 로컬에서 정하는 localPlace 와 로컬 확정을 하는 finish 가 들어간다.
 */
const STEP_ORDER = {
  [SETUP_MODE.MANAGED]: [
    SETUP_STEP_KEYS.LANGUAGE,
    SETUP_STEP_KEYS.INSTALL_MODE,
    SETUP_STEP_KEYS.SITE_CODE,
    SETUP_STEP_KEYS.LOCATION,
    SETUP_STEP_KEYS.ROBOT_INFO,
    SETUP_STEP_KEYS.TERMS,
    SETUP_STEP_KEYS.DOWNLOAD,
    SETUP_STEP_KEYS.MAP_SCAN,
    SETUP_STEP_KEYS.MAP_SEMANTIC,
    SETUP_STEP_KEYS.UPLOAD
  ],
  [SETUP_MODE.STANDALONE]: [
    SETUP_STEP_KEYS.LANGUAGE,
    SETUP_STEP_KEYS.INSTALL_MODE,
    SETUP_STEP_KEYS.LOCAL_PLACE,
    SETUP_STEP_KEYS.MAP_SCAN,
    SETUP_STEP_KEYS.MAP_SEMANTIC,
    SETUP_STEP_KEYS.FINISH
  ]
}

/**
 * 맵 설정 그룹의 첫 화면. 헤더 탭과 '/map' 리다이렉트가 같은 곳을 가리키도록 한 곳에서 정한다.
 * 단독 설치에는 다운로드 화면이 없으므로(관제에서 받을 맵이 없다) 맵 스캔이 입구다.
 *
 * 경로 상수인데 이 모듈에 두는 이유: router/routes.jsx 와 그 안에서 쓰는 리다이렉트 컴포넌트
 * (components/MapGroupIndex)가 둘 다 이 값을 필요로 해서, routes.jsx 에 두면 서로를 import 하는
 * 순환이 된다.
 */
export const mapGroupLanding = (mode) =>
  normalizeMode(mode) === SETUP_MODE.STANDALONE ? '/map/scan' : '/download'

/** 해당 모드의 단계 이름 목록 (읽기용 복사본). */
export const stepOrderFor = (mode) => [...STEP_ORDER[normalizeMode(mode)]]

/**
 * 단계 이름의 1-based 위치. 그 모드에 없는 단계면 0.
 * robot_setups.currentStep 에 함께 저장할 숫자를 만드는 용도다.
 */
export const stepNumberOf = (mode, stepKey) => STEP_ORDER[normalizeMode(mode)].indexOf(stepKey) + 1

/**
 * 1-based 위치의 단계 이름. 범위를 벗어나면 null.
 * 저장된 레코드에 이름이 없을 때(구버전 데이터) 숫자로 되돌려 읽는 용도다.
 */
export const stepKeyAt = (mode, stepNumber) => STEP_ORDER[normalizeMode(mode)][Number(stepNumber) - 1] ?? null
