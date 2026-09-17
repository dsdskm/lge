import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useRobotSetupStatus from '@/hooks/useRobotSetupStatus'
import { mapGroupLanding } from '@/utils/setupSteps'

/**
 * '/map' 리다이렉트. 맵 설정 그룹의 첫 화면으로 보낸다.
 *
 * '/map' 자체는 화면이 없는 부모 메뉴라 직접 진입하면 갈 곳이 필요하고, 그 첫 화면이 설치 모드에
 * 따라 다르다(관제 연동: 다운로드 / 단독: 맵 스캔 — utils/setupSteps.mapGroupLanding). 정적
 * <Navigate> 로는 모드를 알 수 없어 이 컴포넌트가 셋업 상태를 읽어 결정한다.
 *
 * 셋업 조회가 끝나기 전에 보내면 모드가 기본값(managed)으로 굳어 단독 설치에서 없는 화면
 * ('/download')으로 갔다가 catch-all 로 다시 튕긴다 — 조회가 끝날 때까지 기다린다.
 */
const MapGroupIndex = () => {
  const { loading, mode } = useRobotSetupStatus()
  const { t } = useTranslation('layout')

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        {t('loading')}
      </div>
    )
  }

  return <Navigate to={mapGroupLanding(mode)} replace />
}

export default MapGroupIndex
