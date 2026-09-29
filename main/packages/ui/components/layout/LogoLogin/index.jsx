import SvgLogo from '../../../assets/svgs/logo_login.svg'
import { useResponsiveStore } from '@repo/stores/useResponsiveStore'
import { useState } from 'react'

const originalLogoWidth = 440
const originalLogoHeight = 120

function LogoLogin({ disableLink = false }) {
  const { responsiveMode } = useResponsiveStore()
  const [clickCount, setClickCount] = useState(0)
  const logoRatio = originalLogoHeight / originalLogoWidth
  const logoWidth = responsiveMode === 'PC' ? originalLogoWidth : 160
  const logoHeight = logoWidth * logoRatio
  const baseUrl = (import.meta.env && import.meta.env.VITE_PORTAL_BASE_URL) || '/'

  const handleLogoLinkClick = () => {
    if (typeof window === 'undefined') {
      return
    }
    window.location.href = baseUrl
  }

  const handleLogoClick = () => {
    if (typeof window !== 'undefined') {
      return
    }
    if (responsiveMode !== 'PC' && !disableLink) {
      setClickCount((prevCount) => prevCount + 1)
      if (clickCount + 1 === 5) {
        window?.location.replace(`${baseUrl}/`)
      }
    }
  }

  const LogoContent = () => <SvgLogo width={originalLogoWidth} height={originalLogoHeight} />

  return (
    <div className="logo-root">
      {disableLink ? (
        <LogoContent />
      ) : (
        <>
          {responsiveMode === 'PC' ? (
            <div onClick={handleLogoLinkClick} role="link" tabIndex={0} style={{ cursor: 'pointer' }}>
              <LogoContent />
            </div>
          ) : (
            <div onClick={handleLogoClick}>
              <LogoContent />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default LogoLogin
