import { axiosApi } from './crudFactory'

/**
 * 관제 맵/POI 동기화 (init-setup-be: /api/v1/map-sync).
 *
 * 요청을 "보내는" API 와 결과가 "들어오는" API 가 분리된 비동기 흐름이다:
 *   FE ─POST /map-sync/requests─▶ init-setup-be ─gRPC─▶ robot-hub ─▶ connection agent ─▶ 관제
 *   FE ◀───202 + requestId───────┤
 *   관제 ─▶ connection agent ─POST /map-sync/from-dms-connection-agent (다운로드)
 *                             ─POST /map-sync/uploads/complete        (업로드)     ─▶ init-setup-be
 *   FE ◀── WS /map-sync/ws {op:'completed'} ────────────────────────────────────────┤
 *
 * 그래서 POST 응답의 requestId 를 반드시 들고 있어야 하고, 결과는 WS(hooks/useMapSyncRequests)
 * 로 받는다. WS 는 "빠른 알림" 일 뿐이므로 getRequest 폴백이 항상 함께 쓰인다 — 관제 응답이
 * 아주 빨리 오면 FE 가 subscribe 하기 전에 요청이 이미 닫힐 수 있다.
 *
 * 에러는 전역 팝업을 끄고(skipErrorPopup) 화면에서 토스트로 안내한다 — 다운로드/업로드는
 * 목록 화면에서 여러 건이 동시에 돌 수 있어 모달로 막으면 다른 행의 진행을 가린다.
 */

/** POST /map-sync/requests — download/upload 통합 발신. 202 + requestId 로 즉시 응답한다. */
export const createRequest = async (body) => {
  return await axiosApi.post('/map-sync/requests', body, { skipErrorPopup: true })
}

/**
 * GET /map-sync/requests/:requestId — 요청 진행 상태(WS 폴백).
 * BE 는 이 조회 시점에도 타임아웃을 판정하므로, 응답이 끊긴 요청도 여기서 timeout 으로 닫힌다.
 */
export const getRequest = async (requestId) => {
  return await axiosApi.get(`/map-sync/requests/${requestId}`, { skipErrorPopup: true })
}

/**
 * GET /map-sync/requests — 요청 목록. 응답 행에는 위치 계층(area→floor→building→site)과
 * 로컬 areaId 가 함께 실려 오므로, 화면 진입 시 "이 구역의 최근 요청 상태" 를 복원할 수 있다.
 * @param {{status?: 'pending'|'completed'|'failed'|'timeout', type?: 'download'|'upload',
 *   limit?: number, offset?: number}} [params]
 */
export const listRequests = async (params) => {
  return await axiosApi.get('/map-sync/requests', { params, skipErrorPopup: true })
}

/**
 * 맵/POI 다운로드 요청. 위치는 모두 관제 외부 ID(extId)로 넘긴다 — 로컬 PK 가 아니다.
 * groupId 는 사이트 스코프 조회(siteApis.retrieveSiteScope)의 응답에서 얻는다.
 *
 * @param {{groupId: string, siteId: string, buildingId: string, floorId: string, areaId: string,
 *   targets?: string[]}} location targets 기본값 ['navi','poi'] (BE 허용값: navi|poi|svg)
 * @returns {Promise<{success: boolean, data: {requestId: string, status: 'pending',
 *   targets: string[], location: object, message: string}}>}
 */
export const requestMapDownload = async ({ groupId, siteId, buildingId, floorId, areaId, targets }) => {
  return await createRequest({
    type: 'download',
    groupId,
    siteId,
    buildingId,
    floorId,
    areaId,
    targets: targets ?? ['navi', 'poi']
  })
}
