/**
 * 릴리즈 전 기능의 노출 플래그.
 *
 * 기준은 점검 모드의 AST 뷰(FlowCanvasViewer 의 IS_LOCAL_ENV)와 같게 맞춘다.
 * 기준을 따로 두면 "어떤 빌드에서 무엇이 보이는지"가 두 갈래가 되어 추적이 어려워진다.
 *
 * 참고: .env.local 은 Vite 가 모든 mode 에서 읽고, .env.dev / .env.qa / .env.prod 에는
 * VITE_ENV 가 없다. 그래서 현재는 어느 빌드에서도 이 값이 'local' 로 남는다.
 * 빌드별로 갈라야 한다면 각 env 파일에 VITE_ENV 를 넣는 것이 먼저다.
 */
const IS_LOCAL_ENV = import.meta.env.VITE_ENV === 'local'

/** Task(Action) 관리 화면 노출 여부. */
export const SHOW_TASK_MANAGEMENT = IS_LOCAL_ENV
