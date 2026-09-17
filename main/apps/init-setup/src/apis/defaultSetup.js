import { axiosApi } from './crudFactory'

/** 설치 모드 조회 → { success, mode: 'managed'|'standalone', decided } */
export const getInstallMode = () => axiosApi.get('/default-setup/install-mode')

/**
 * 설치 모드 저장. standalone 이면 BE 가 로컬 위치 계층(Local/1F/Default)까지 함께 준비하고
 * site_position 을 로컬 값으로 발행한다(init-setup-be defaultSetup.service.saveInstallMode).
 * @param {'managed'|'standalone'} mode
 */
export const saveInstallMode = (mode) => axiosApi.post('/default-setup/install-mode', { mode })

export const saveSiteCode = (payload) => axiosApi.post('/default-setup/site-code', payload)
export const getOperationLocation = () => axiosApi.get('/default-setup/operation-location')
export const saveOperationLocation = (payload) => axiosApi.post('/default-setup/operation-location', payload)
export const saveRobotInfo = (payload) => axiosApi.post('/default-setup/robot-info', payload)
