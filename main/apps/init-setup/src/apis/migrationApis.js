import { axiosApi } from './crudFactory'

/**
 * 단독 설치 → 관제 연동 전환 (init-setup-be: /api/v1/migration).
 *
 * 단독 설치로 만든 맵은 로컬 위치 계층('LOCAL-' 행)에 매달려 있어 그대로는 관제로 올릴 수 없다
 * (업로드가 쓰는 식별자는 관제 extId 다 — init-setup-be mapUpload.service).
 * 전환은 모드 전환 → 맵별 재매핑 → 로컬 계층 정리 순서로 진행한다.
 */

/**
 * 전환 상태.
 * @returns {Promise<{success: boolean, available: boolean, active: boolean, canFinish: boolean,
 *   localSiteId: number|null, cloudSite: {id: number, extId: string, siteCode: string}|null,
 *   maps: {id: number, name: string, status: string, areaId: number|null, place: string}[]}>}
 *   available: 전환을 시작할 수 있다 / active: 진행 중 / canFinish: 옮길 맵이 없다
 */
export const getMigration = () => axiosApi.get('/migration')

/** 전환 시작 — 설치 모드를 managed 로 올려 관제 화면(네트워크·로그인·사이트 코드·다운로드)을 다시 연다. */
export const startMigration = () => axiosApi.post('/migration/start', {})

/**
 * 맵 1건을 관제 Area 로 옮긴다. 소속(siteId/areaId)과 표시 이름이 바뀌고, 아직 관제에 없는 POI 가
 * 업로드 대상으로 다시 표시된다.
 * @param {number|string} mapId
 * @param {number|string} areaId 관제에서 받은 Area id
 */
export const remapMap = (mapId, areaId) => axiosApi.post(`/migration/maps/${mapId}/remap`, { areaId })

/** 로컬 위치 계층 정리. 옮기지 않은 맵이 남아 있으면 409(maps_not_remapped). */
export const finishMigration = () => axiosApi.post('/migration/finish', {})
