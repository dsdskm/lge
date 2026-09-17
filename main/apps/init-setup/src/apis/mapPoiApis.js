import { axiosApi, createCrud } from './crudFactory'

// 맵 POI (Map 하위, bulk 생성 지원) (init-setup-be: /api/v1/map-pois)
export const { create, list, getById, update, remove, bulkCreate } = createCrud('map-pois', { bulk: true })

/**
 * 로컬 확정 (POST /map-pois/commit-local).
 *
 * 단독 설치에서 편집 결과를 이 로봇 안에서 확정한다 — 삭제 예정(editStatus.softDelete) POI 를
 * 실제로 지우고 남은 POI 의 editStatus 를 비운다. 관제 연동 설치에서는 POI 업로드 응답 처리가
 * 같은 일을 하므로 이 호출을 쓰지 않는다(init-setup-be mapUpload.service.uploadPoiBatch).
 *
 * @param {number|string} mapId 확정할 맵 레코드 id
 * @returns {Promise<{success: boolean, data: {mapId: number, deleted: number, committed: number}}>}
 */
export const commitLocal = (mapId) => axiosApi.post('/map-pois/commit-local', { mapId })
