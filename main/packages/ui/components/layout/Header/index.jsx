import {
  StyledHeader,
  StyledHeaderButton,
  StyledProfileContainer,
  StyledProfileDropdown,
  StyledAiAssistantCard,
  StyledAiAssistantLabel,
  StyledThemeToggle
} from './styles'
import Button from '../../common/Button'
import LanguageSelect from '../LanguageSelect'
import IconButton from '../../common/IconButton'
import Logo from '../Logo'
import SvgMenu from '../../../assets/svgs/gnb_header_menu.svg'
import SvgNotification from '../../../assets/svgs/notification.svg'
import { useAiAssistantStore, useResponsiveStore, useSideBarStore, useUserStore, useThemeStore } from '@repo/stores'
import { logout as requestLogout } from '@repo/apis'
import ServiceMenuIcon from '../ServiceMenuIcon'
import LearningNotification from './LearningNotification'
import MyProfileModal from './MyProfileModal'
import { COMMON_GNB } from '@repo/constants/routes'
import { useTranslation } from 'react-i18next'
import useToggle from '@repo/hooks/useToggle'
import useClickOutSide from '@repo/hooks/useClickOutSide'
import { useRef, useMemo } from 'react'
import Icon from '../../common/Icon'

const Header = ({ notificationSlot }) => {
  const { t } = useTranslation('layout')
  const { toggleSideBar } = useSideBarStore()
  const { theme, toggleTheme } = useThemeStore()
  const { responsiveMode } = useResponsiveStore()
  const email = useUserStore((state) => state.session?.email)
  const openAiAssistantPanel = useAiAssistantStore((state) => state.openPanel)

  const { state: isProfileOpen, toggle: toggleProfile, off: closeProfile } = useToggle()
  const profileRef = useRef(null)
  useClickOutSide(profileRef, closeProfile)

  const { state: isMyProfileOpen, on: openMyProfile, off: closeMyProfile } = useToggle()

  // FEATURE_LEARNING_ENABLED에 따라 "학습" 앱 필터링
  const headerRoutes = useMemo(() => {
    if (import.meta.env.VITE_FEATURE_LEARNING_ENABLED === 'true') {
      return COMMON_GNB
    }
    // "학습" 앱 제외
    return COMMON_GNB.filter((item) => item.name !== 'learning')
  }, [])

  const handleLogout = async () => {
    const refreshToken = useUserStore.getState().session?.refreshToken

    try {
      await requestLogout(refreshToken)
    } catch (error) {
      // 무효화 실패 여부와 관계없이 로그아웃은 계속 진행
    }

    useUserStore.getState().logout()
    window.location.href = '/login'
  }

  const handleClickAiAssistant = () => {
    openAiAssistantPanel()
  }

  const handleMyProfile = () => {
    closeProfile()
    openMyProfile()
  }

  return (
    <StyledHeader className="header">
      <div className="containerHeader">
        <div className="content left">
          {/* 사이드바 폭(--sidebar-width)에 맞춰 로봇관리 등 탭이 사이드바 우측 경계 뒤에서 시작하도록 정렬.
              헤더 자체 좌측 패딩(containerHeader의 2.4rem)은 사이드바에는 없으므로 그만큼 빼서 보정 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1.4rem',
              minWidth: 'calc(var(--sidebar-width) - 2.4rem)',
              flexShrink: 0
            }}
          >
            <StyledHeaderButton
              type="button"
              onClick={toggleSideBar}
              aria-label="Open Sidebar"
              className="hideOnMobile menuToggle"
            >
              <i className="icon">
                <SvgMenu />
              </i>
            </StyledHeaderButton>

            <Logo />
          </div>

          <ServiceMenuIcon t={t} headerRoutes={headerRoutes} />
        </div>

        <div className="content right">
          <StyledThemeToggle type="button" onClick={toggleTheme} title={t('ThemeToggle.title')}>
            {theme === 'new' ? t('ThemeToggle.classicBlue') : t('ThemeToggle.modernNeutral')}
          </StyledThemeToggle>

          <LanguageSelect />

          {import.meta.env.VITE_FEATURE_LEARNING_ENABLED === 'true' && <LearningNotification />}

          {notificationSlot ?? (
            <StyledHeaderButton type="button" className="notification" aria-label="View Notifications">
              <i className="icon">
                <SvgNotification />
              </i>
            </StyledHeaderButton>
          )}

          <StyledProfileContainer ref={profileRef}>
            {responsiveMode === 'PC' ? (
              <Button type="button" theme="dark" onClick={toggleProfile}>
                <span>{email}</span>
                <span style={{ marginLeft: '4px', display: 'flex', alignItems: 'center' }}>
                  <Icon name={isProfileOpen ? 'arrow_up' : 'arrow_down'} size={16} />
                </span>
              </Button>
            ) : (
              <IconButton type="button" className="mobile" theme="dark" name="profile" onClick={toggleProfile} />
            )}

            {isProfileOpen && (
              <StyledProfileDropdown className={responsiveMode}>
                <button type="button" onClick={handleMyProfile}>
                  <Icon name="profile" size={16} />
                  {t('Header.myProfile')}
                </button>
                <button type="button" onClick={handleLogout}>
                  <Icon name="sign_out" size={16} />
                  Logout
                </button>
              </StyledProfileDropdown>
            )}
          </StyledProfileContainer>
        </div>
      </div>

      <MyProfileModal isOpen={isMyProfileOpen} onClose={closeMyProfile} onLogout={handleLogout} />
    </StyledHeader>
  )
}

export default Header
