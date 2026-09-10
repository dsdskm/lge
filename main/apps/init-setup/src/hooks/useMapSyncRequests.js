import { useCallback, useEffect, useRef, useState } from 'react'
import { getRequest, listRequests } from '@/apis/mapSyncApis'
import { resolveMapSyncWsUrl } from '@/utils/wsUrl'

/**
 * useMapSyncRequests — 관제 맵/POI 동기화 요청의 진행 상태를 추적한다.
 *
 * 요청 발신(POST /map-sync/requests)은 202 + requestId 로 즉시 끝나고 결과는 나중에 관제 →
 * connection agent → BE 로 들어온다. BE 는 그 시점에 /map-sync/ws 로 {op:'completed'} 를
 * 밀어주므로(init-setup-be telemetry/mapSyncNotifier.js), 화면은 이 훅으로 결과를 받는다.
 *
 * WS 는 "빠른 알림" 일 뿐이고 최종 확인은 항상 REST 로도 가능해야 한다 — 다음 세 구멍 때문이다.
 *  ① 경합: 관제 응답이 아주 빨리 오면 FE 가 subscribe 를 보내기 전에 요청이 이미 닫힌다.
 *     → subscribe 직후 GET 으로 한 번 확인한다.
 *  ② 단절: WS 가 끊긴 사이에 닫힌 요청의 알림은 유실된다. BE 는 구독 시점의 현재 상태를
 *     되돌려주지 않는다(순간 이벤트만 중계).
 *     → 재연결할 때마다 pending 을 다시 subscribe 하고 GET 으로 맞춘다.
 *  ③ WS 자체가 불가한 환경.
 *     → WS 가 열려 있지 않은 동안에만 주기 폴링한다(열려 있으면 BE 가 밀어주므로 폴링하지 않는다).
 *
 * 화면 진입 시 자동으로 최근 요청 목록을 읽어 상태를 복원한다(autoResume) — 다운로드/업로드
 * 페이지는 요청을 걸어 두고 나갔다가 다시 들어올 수 있고, 요청은 최대 5분(BE 의
 * MAP_SYNC_REQUEST_TIMEOUT_MS)까지 pending 으로 살아 있다.
 *
 * @param {{type?: 'download'|'upload', autoResume?: boolean,
 *   onSettled?: (request: object) => void}} [options]
 *   type: 복원·폴링 대상 종류(미지정 시 전체). onSettled: 종료 상태 도달 시 1회 호출.
 * @returns {{requests: object, byAreaId: object, track: Function, connected: boolean,
 *   refresh: Function}}
 *   requests: { [requestId]: {requestId, type, status, areaId, errorMessage, completedAt} }
 *   byAreaId: 같은 내용을 로컬 areaId 로 색인한 것(구역 단위 목록 화면에서 바로 쓴다)
 */

const SETTLED_STATUSES = ['completed', 'failed', 'timeout']

/** 종료 상태(더 기다릴 필요가 없는 상태)인지. */
export const isSettled = (status) => SETTLED_STATUSES.includes(status)

// WS 가 끊겨 있을 때만 도는 폴백 폴링 주기. 요청 자체가 분 단위 왕복이라 짧게 돌 이유가 없다.
const FALLBACK_POLL_MS = 15000
// 재연결 간격. init-setup-be 의 텔레메트리 재구독 간격(TELEMETRY_RECONNECT_MS 기본 2s)과 맞춘다.
const RECONNECT_DELAY_MS = 2000

/** BE 요청 레코드/WS 페이로드를 화면이 쓰는 최소 형태로 정규화한다. */
const normalize = (raw, fallback = {}) => ({
  requestId: raw?.requestId ?? fallback.requestId,
  type: raw?.type ?? fallback.type,
  status: raw?.status ?? fallback.status ?? 'pending',
  // 로컬 Area PK. BE 요청 레코드는 이 값을 들고 있지만(map_sync_requests.area_id) 발신 응답
  // (POST /requests)에는 없어서, 그때는 호출부가 track 의 meta 로 넘겨준다.
  areaId: raw?.areaId ?? fallback.areaId ?? null,
  errorMessage: raw?.errorMessage ?? null,
  completedAt: raw?.completedAt ?? null,
  // 발신 응답과 WS 페이로드에는 createdAt 이 없다 — 그때는 "지금 만든 요청" 이므로 현재 시각이 맞다.
  createdAt: raw?.createdAt ?? fallback.createdAt ?? new Date().toISOString(),
  result: raw?.result ?? null
})

export function useMapSyncRequests({ type, autoResume = true, onSettled } = {}) {
  const [requests, setRequests] = useState({})
  const [connected, setConnected] = useState(false)

  const requestsRef = useRef({})
  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const aliveRef = useRef(true)
  // onSettled 가 매 렌더 새로 만들어져도 WS 를 다시 열지 않도록 ref 로 고정한다.
  const onSettledRef = useRef(onSettled)
  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  const pendingIds = () =>
    Object.values(requestsRef.current)
      .filter((request) => !isSettled(request.status))
      .map((request) => request.requestId)

  /** 상태를 병합 반영하고, 종료 상태로 처음 넘어간 요청만 onSettled 로 알린다. */
  const merge = useCallback((raw, fallback) => {
    const next = normalize(raw, fallback)
    if (!next.requestId) return
    const previous = requestsRef.current[next.requestId]
    // areaId·type·createdAt 은 페이로드에 따라 빠져 있다(POST 응답에는 areaId 가 없고 WS
    // 통지에는 createdAt 이 없다) — 이미 알고 있던 값을 덮어쓰지 않는다.
    if (previous?.areaId != null && next.areaId == null) next.areaId = previous.areaId
    if (previous?.type && !next.type) next.type = previous.type
    if (previous?.createdAt && !raw?.createdAt) next.createdAt = previous.createdAt

    requestsRef.current = { ...requestsRef.current, [next.requestId]: next }
    setRequests(requestsRef.current)

    if (isSettled(next.status) && !isSettled(previous?.status)) onSettledRef.current?.(next)
  }, [])

  /** REST 로 현재 상태를 확인한다(WS 경합·유실 보정). 실패는 조용히 넘긴다 — 다음 기회에 다시 본다. */
  const verify = useCallback(
    async (requestId) => {
      try {
        const response = await getRequest(requestId)
        if (aliveRef.current) merge(response?.data, { requestId })
      } catch (error) {
        console.warn('[mapSync] 요청 상태 조회 실패:', requestId, error?.message)
      }
    },
    [merge]
  )

  const send = (message) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }

  /**
   * 요청을 추적 대상에 넣는다(발신 직후 호출).
   * @param {string} requestId POST /map-sync/requests 응답의 requestId
   * @param {{areaId?: number, type?: string, status?: string}} [meta] 발신 응답에 없는 정보
   */
  const track = useCallback(
    (requestId, meta = {}) => {
      if (!requestId) return
      merge({ requestId, status: meta.status ?? 'pending' }, { ...meta, requestId })
      send({ op: 'subscribe', requestIds: [requestId] })
      // ① 경합 보정 — subscribe 보다 먼저 닫혔을 수 있다.
      verify(requestId)
    },
    [merge, verify]
  )

  /** 최근 요청 목록으로 상태를 복원하고, 아직 pending 인 것은 구독한다. */
  const refresh = useCallback(async () => {
    try {
      const response = await listRequests({ ...(type ? { type } : {}), limit: 100 })
      if (!aliveRef.current) return
      const rows = response?.data ?? []
      rows.forEach((row) => merge(row))
      const ids = rows.filter((row) => !isSettled(row.status)).map((row) => row.requestId)
      if (ids.length > 0) send({ op: 'subscribe', requestIds: ids })
    } catch (error) {
      console.warn('[mapSync] 요청 목록 조회 실패:', error?.message)
    }
  }, [merge, type])

  // WS 연결 — 화면에 머무는 동안 유지하고, 끊기면 재연결한다.
  useEffect(() => {
    aliveRef.current = true

    const connect = () => {
      if (!aliveRef.current) return

      const ws = new WebSocket(resolveMapSyncWsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        if (!aliveRef.current) return
        setConnected(true)
        // ② 단절 보정 — 끊긴 사이의 알림은 유실되므로 재구독 + 현재 상태 재확인을 함께 한다.
        const ids = pendingIds()
        if (ids.length > 0) {
          send({ op: 'subscribe', requestIds: ids })
          ids.forEach(verify)
        }
      }

      ws.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message?.op === 'completed') merge(message.data)
      }

      ws.onclose = () => {
        setConnected(false)
        if (!aliveRef.current) return
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }

      // onerror 뒤에는 항상 onclose 가 오므로 재연결은 그쪽에서만 건다(중복 타이머 방지).
      ws.onerror = () => setConnected(false)
    }

    connect()

    return () => {
      aliveRef.current = false
      clearTimeout(reconnectTimerRef.current)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        // 정리 중의 close 로 재연결 타이머가 다시 걸리지 않게 핸들러를 먼저 뗀다.
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
    }
  }, [merge, verify])

  // 화면 진입 시 최근 요청 상태 복원.
  useEffect(() => {
    if (autoResume) refresh()
  }, [autoResume, refresh])

  // ③ WS 가 열려 있지 않은 동안에만 pending 을 폴링한다(열려 있으면 BE 가 밀어준다).
  useEffect(() => {
    if (connected) return

    const timerId = setInterval(() => {
      pendingIds().forEach(verify)
    }, FALLBACK_POLL_MS)
    return () => clearInterval(timerId)
  }, [connected, verify])

  const byAreaId = Object.values(requests).reduce((acc, request) => {
    if (request.areaId == null) return acc
    // 같은 구역에 여러 요청이 있으면 진행 중인 것을, 둘 다 종료됐으면 최근 것을 보여준다.
    const current = acc[request.areaId]
    if (!current) {
      acc[request.areaId] = request
      return acc
    }
    const currentPending = !isSettled(current.status)
    const nextPending = !isSettled(request.status)
    if (nextPending && !currentPending) acc[request.areaId] = request
    else if (nextPending === currentPending && request.createdAt > current.createdAt) acc[request.areaId] = request
    return acc
  }, {})

  return { requests, byAreaId, track, connected, refresh }
}
