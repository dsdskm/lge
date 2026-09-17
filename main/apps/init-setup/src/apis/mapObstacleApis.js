import { axiosApi, createCrud } from './crudFactory'

// 가상 장애물 (Map 하위) (init-setup-be: /api/v1/map-obstacles)
export const { create, list, getById, update, remove } = createCrud('map-obstacles')

/**
 * 타입/형태 enum 과 형태별 점 개수 규칙 (GET /map-obstacles/meta).
 * 값은 로봇(corepath_msgs/VirtualObstacle)과 약속된 것이라 화면에 하드코딩하지 않고 BE 에서 받는다.
 * @returns {Promise<{success: boolean, data: {types: object, userSelectableTypes: number[],
 *   shapes: string[], shapePointRange: object, maxPoints: number, files: string[]}}>}
 */
export const meta = () => axiosApi.get('/map-obstacles/meta')

/**
 * 맵 하나의 가상 장애물 전체 치환 (PUT /map-obstacles/bulk).
 *
 * 로봇 프로토콜이 full-state(배열 전체가 곧 상태)라 저장도 전체로 보낸다 —
 * 개별 삭제 호출은 없고 "보내지 않은 것" 이 삭제다. obstacles: [] 는 전체 삭제다.
 *
 * @param {{mapId: number|string, obstacles: Array<{obsId?: number, type: number, name?: string,
 *   shape: string, points: Array<{x: number, y: number, z: number}>}>}} data
 * @returns {Promise<{success: boolean, data: object[], count: number}>}
 */
export const bulkReplace = (data) => axiosApi.put('/map-obstacles/bulk', data)

// DB → vo_*.yaml 내보내기 API(구 POST /map-obstacles/apply)는 없다 — 로봇이 읽는 워크스페이스
// 파일은 corepath 가 만들고, 관제로는 업로드 화면이 POI batch 의 vo 키로 함께 올린다
// (pages/Upload/uploadTable, utils/poiBatch).
