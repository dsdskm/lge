/**
 * init-setup-be WebSocket URL 해석(텔레메트리 릴레이 / map-sync 완료 통지).
 *
 * 브라우저는 zenoh 에 직접 붙지 않는다 — zenoh-bridge-ros2dds 는 tcp/7448(zenoh)과 8001(REST)을
 * loopback 으로만 리슨하고 WebSocket(remote-api) 플러그인이 없다. 그래서 init-setup-be 가 브릿지를
 * 구독해(REST SSE) 자체 WS 로 중계하고(src/telemetry/relay.js), FE 는 그 WS 에 붙는다.
 *
 * 주소 규칙은 apis/index.js 의 API_BASE 와 같은 이유로 현재 페이지 기준이다 — 폰/PC 가 로봇 AP 로
 * 접속하는 구성에서 localhost 나 빌드 시점 IP 가 박히면 깨진다.
 *   - nginx 로 서빙되는 빌드: 같은 오리진의 상대 경로(/telemetry). nginx 가 BE 로 Upgrade 프록시한다.
 *   - vite dev(5181): /telemetry 프록시가 없으므로 BE 포트(VITE_BE_PORT)로 직접 붙는다.
 *
 * VITE_TELEMETRY_WS_URL 을 지정하면 그 값을 그대로 쓴다(별도 릴레이를 붙이는 디버깅용).
 * 이때 host 만 현재 페이지 hostname 으로 바꿔 준다.
 * ※ 옛 VITE_WEBSOCKET_URL(foxglove-bridge :8765)은 더 읽지 않는다 — 각 .env 에 값이 남아 있어서
 *   폴백으로 두면 로봇 빌드가 조용히 foxglove 로 되돌아간다.
 */
const TELEMETRY_PATH = '/telemetry'
// map-sync(다운로드/업로드) 완료 통지 WS. init-setup-be 의 MAP_SYNC_WS_PATH 기본값과 같아야 한다
// (config.mapSync.wsPath). nginx 도 이 경로만 별도로 Upgrade 프록시한다(docker/nginx.conf).
const MAP_SYNC_PATH = '/map-sync/ws'

/** 위 주소 규칙(현재 페이지 기준, dev 는 BE 포트 직결)을 경로별로 공유한다. */
function resolvePathWsUrl(path) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.hostname || 'localhost'

  // dev 서버에는 WS 프록시가 없다 — BE 를 직접 부른다.
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_BE_PORT
    return `${wsProtocol}//${host}${port ? `:${port}` : ''}${path}`
  }

  return `${wsProtocol}//${window.location.host}${path}`
}

export function resolveWsUrl() {
  const override = import.meta.env.VITE_TELEMETRY_WS_URL

  if (override) {
    try {
      const url = new URL(override)
      url.hostname = window.location.hostname || 'localhost'
      return url.toString()
    } catch {
      return override
    }
  }

  return resolvePathWsUrl(TELEMETRY_PATH)
}

/**
 * map-sync 완료 통지 WS 주소. 텔레메트리와 같은 BE·같은 포트의 다른 경로다.
 * VITE_TELEMETRY_WS_URL 오버라이드는 적용하지 않는다 — 그 값은 별도 텔레메트리 릴레이를
 * 붙일 때 쓰는 디버깅용이고, map-sync 통지는 그 릴레이가 말하지 않는 프로토콜이다.
 */
export function resolveMapSyncWsUrl() {
  return resolvePathWsUrl(MAP_SYNC_PATH)
}
