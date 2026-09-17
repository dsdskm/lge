import { useSideBarStore } from '@repo/stores'
import { LanguageSelect } from '@repo/ui'
import { StyledHeader, StyledHeaderButton } from '@repo/ui/components/layout/Header/styles'
import { StyledNavButton } from '@repo/ui/components/layout/ServiceMenuIcon/styles'
import SvgMenu from '@repo/ui/assets/svgs/menu.svg'
import SvgWifi from '@/assets/wifi.svg'
import Logo from '../Logo'
import { NETWORK_SETUP_PATH } from '@/hooks/useNetworkGate'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { HEADER_GNB, getRouteGroup, FLAT_APP_ROUTES } from '@/router/routes'
import useRobotSetupStatus from '@/hooks/useRobotSetupStatus'
import { SETUP_MODE } from '@/utils/setupSteps'
import SetupOrderModal from '../SetupOrderModal'

// 헤더 탭은 같은 앱 안의 메뉴 그룹 전환이므로 SPA 네비게이션으로 이동한다.
// (공용 ServiceMenuIcon 은 앱 간 이동용이라 window.location.href 로 전체 리로드를 한다)
const GroupTabs = ({ tabs, t }) => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { setCompactSideBar } = useSideBarStore()
  const activeGroup = getRouteGroup(FLAT_APP_ROUTES, pathname)
  // 선행 단계가 남아 클릭이 막힌 탭 (locked). 현재 화면은 그대로 두고 안내 모달만 띄운다.
  const [blockedTab, setBlockedTab] = useState(null)

  // 탭이 하나만 남는 경우(셋업 완료 + 관리자 권한 없음 = 맵 설정 하나)에도 그대로 노출한다 —
  // 여기서 숨기면 헤더에 로고만 남아 현재 그룹을 알 수 없다. 목록이 빈 경우만 그리지 않는다.
  if (!tabs.length) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'nowrap', minWidth: 0 }}>
      {tabs.map((tab) => (
        <StyledNavButton
          key={tab.name}
          type="button"
          className="typographyHeading6"
          $isActive={tab.group === activeGroup}
          onClick={() => {
            if (tab.locked) {
              setBlockedTab(tab)
              return
            }
            if (typeof window !== 'undefined' && window.innerWidth <= 767) {
              setCompactSideBar(true)
            }
            navigate(tab.path)
          }}
        >
          {t(`SideBar.gnb.${tab.name}`)}
        </StyledNavButton>
      ))}
      {blockedTab && (
        <SetupOrderModal
          isOpen
          pendingPath={blockedTab.pendingPath}
          pendingLabel={blockedTab.pendingLabel}
          onClose={() => setBlockedTab(null)}
        />
      )}
    </div>
  )
}

// Wi-Fi 설정 바로가기. 네트워크 설정은 설치 단계에서 빠져(routes.jsx) 사이드바에 항목이 없으므로
// 이 아이콘이 유일한 입구다 — 셋업 완료 후에도 Wi-Fi 는 다시 바꿀 수 있어야 한다.
const WifiButton = ({ label }) => {
  const navigate = useNavigate()

  return (
    <StyledHeaderButton
      type="button"
      onClick={() => navigate(NETWORK_SETUP_PATH)}
      aria-label={label}
      title={label}
      // 헤더는 어두운 배경이라 아이콘(stroke: currentColor)을 로고와 같은 흰색으로 맞춘다.
      style={{ color: 'var(--color-neutral-10)', display: 'inline-flex', alignItems: 'center' }}
    >
      <i className="icon">
        <SvgWifi />
      </i>
    </StyledHeaderButton>
  )
}

/**
 * 단독 설치 배지. 관제 연동 설치와 메뉴 구성이 다르므로(사이트 코드 · 다운로드 · 업로드가 없다)
 * 설치자가 "화면이 빠진 것" 이 아니라 "모드가 단독" 임을 알 수 있어야 한다.
 * 관제 연동(기본)에서는 아무것도 그리지 않는다 — 기존 화면에 새 표시를 더하지 않는다.
 */
const ModeBadge = ({ label }) => (
  <span
    className="typographyBody3"
    title={label}
    style={{
      color: 'var(--color-neutral-10)',
      border: '1px solid var(--color-neutral-10)',
      borderRadius: '0.4rem',
      padding: '0.2rem 0.8rem',
      whiteSpace: 'nowrap'
    }}
  >
    {label}
  </span>
)

const CustomHeader = ({ headerRoutes = HEADER_GNB }) => {
  const { toggleSideBar } = useSideBarStore()
  const { t } = useTranslation('route')
  const { t: setupT } = useTranslation('setup')
  const { mode } = useRobotSetupStatus()

  return (
    <StyledHeader className="header">
      <div className="containerHeader">
        <div className="content left">
          <StyledHeaderButton type="button" onClick={toggleSideBar} aria-label="Open Sidebar" className="hideOnMobile">
            <SvgMenu />
          </StyledHeaderButton>
          <Logo />
          <GroupTabs tabs={headerRoutes} t={t} />
        </div>
        <div className="content right">
          {mode === SETUP_MODE.STANDALONE && <ModeBadge label={setupT('installMode.standalone')} />}
          <WifiButton label={t('SideBar.gnb.network')} />
          <LanguageSelect />
        </div>
      </div>
    </StyledHeader>
  )
}

export default CustomHeader
