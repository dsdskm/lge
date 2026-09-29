import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  StyledPageContent,
  PageHero,
  HeroText,
  HeroTitle,
  HeroDescription,
  BadgeGroup,
  StatusBadge,
  SummaryGrid,
  SummaryCard,
  SummaryLabel,
  SummaryValue,
  SummaryHint,
  SectionCard,
  SectionHeader,
  SectionTitle,
  SectionDescription,
  ActionButton,
  WifiGrid,
  WifiCard,
  WifiCardRow,
  WifiMain,
  WifiNameRow,
  WifiName,
  WifiMeta,
  WifiChip,
  SignalBars,
  SignalBar,
  EmptyState,
  EmptyIcon,
  Spinner,
  WifiLoadingState,
  ConnectPanel,
  ConnectPanelTop,
  WifiConnectInline,
  PasswordField,
  PasswordInput,
  TogglePasswordButton,
  ButtonWrap,
  SwitchingPanel,
  SwitchingIcon,
  SwitchingContent,
  ReconnectBox,
  ReconnectLink,
  CountdownPill,
  SmallNote,
  ManualGrid,
  ManualLabel,
  SecondaryActionButton,
  WizardButtonWrap
} from './styles'
import { Section } from '@repo/ui'
import { useUserStore } from '@repo/stores'
import {
  scanWifi,
  connectWifi,
  disconnectWifi,
  rescanWifiOffline,
  getWifiStatus,
  getWifiModeStatus,
  switchWifiMode
} from '@/apis/wifi'
import { deriveRobotOnline, bypassNetworkGate } from '@/utils/networkStatus'
import { publishRobotOnline } from '@/hooks/useRobotOnline'

const UI_PORT = '18080'
const FIXED_ACCESS_URLS = {
  lan: `http://192.168.55.1:${UI_PORT}`,
  ap: `http://192.168.10.1:${UI_PORT}`,
  wifi: ''
}

const normalizeIp = (value = '') =>
  String(value || '')
    .split('/')[0]
    .trim()

const buildWifiUrl = (ip) => {
  const cleanIp = normalizeIp(ip)
  return cleanIp ? `http://${cleanIp}:${UI_PORT}` : ''
}

const getDefaultReconnectUrl = () => {
  const protocol = window.location.protocol || 'http:'
  const host = window.location.hostname || 'localhost'
  return `${protocol}//${host}`
}

const getSignalLabel = (signal = 0, t) => {
  if (signal >= 80) return t('network.signal.excellent')
  if (signal >= 60) return t('network.signal.good')
  if (signal >= 40) return t('network.signal.fair')
  return t('network.signal.weak')
}

const getSignalBars = (signal = 0) => {
  if (signal >= 80) return 4
  if (signal >= 60) return 3
  if (signal >= 40) return 2
  return 1
}

// 배지에는 로봇이 쓰는 원시 모드 값(single_wifi 등)을 그대로 보여주지 않는다 — 일반 사용자에게는
// wlan0/wlan1, STA/AP 같은 인터페이스 용어가 아니라 지금 상태를 바로 알 수 있는 말이 필요하다.
const modeBadgeLabel = (mode, t) => {
  if (mode === 'concurrent') return t('network.mode.badge.concurrent')
  if (mode === 'single_wifi') return t('network.mode.badge.singleWifi')
  if (mode === 'single_ap') return t('network.mode.badge.singleAp')
  return t('network.mode.badge.unknown')
}

const isOpenNetwork = (network) => {
  const security = String(network?.security || '').toUpperCase()
  return !security || security === '--' || security === 'OPEN' || security === 'NONE'
}

const CONNECTION_VERIFY_ATTEMPTS = 8
const CONNECTION_VERIFY_DELAY_MS = 2500

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

const sameSsid = (a, b) => String(a || '').trim() === String(b || '').trim()

const findConnectedNetwork = (networks = [], ssid = '') => {
  const list = Array.isArray(networks) ? networks : []
  return list.find((network) => network?.in_use && (!ssid || sameSsid(network.ssid, ssid))) || null
}

const Network = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  // 로그인 전(네트워크 게이트로 넘어온 진입)에는 다음 단계로 진행할 수 없다 —
  // 뒤 단계는 클라우드 로그인이 전제이므로 Wi-Fi 를 붙인 뒤 로그인으로 되돌려 보낸다.
  const hasSession = useUserStore((state) => Boolean(state.session?.accessToken))
  const [networks, setNetworks] = useState([])
  const [loading, setLoading] = useState(false)
  const [scanMessage, setScanMessage] = useState(() => t('network.notScanned'))

  const [selected, setSelected] = useState(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualSsid, setManualSsid] = useState('')
  const [manualHidden, setManualHidden] = useState(false)

  const [connecting, setConnecting] = useState(false)
  const [showSwitchingGuide, setShowSwitchingGuide] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [connectMessage, setConnectMessage] = useState('')
  const [connectionNotice, setConnectionNotice] = useState('')
  const [connectionState, setConnectionState] = useState('idle')
  const [nextUrl, setNextUrl] = useState(getDefaultReconnectUrl())

  const [wifiMode, setWifiMode] = useState({
    apMode: false,
    cached: false,
    method: '-',
    iface: '-'
  })
  const [accessUrls, setAccessUrls] = useState(FIXED_ACCESS_URLS)
  const [wifiModeStatus, setWifiModeStatus] = useState(null)
  const [modeChanging, setModeChanging] = useState(false)
  const [modeMessage, setModeMessage] = useState('')

  const targetSsid = manualMode ? manualSsid.trim() : selected?.ssid || ''
  const selectedName = targetSsid || t('network.hiddenNetwork')
  const selectedIsOpen = useMemo(() => (manualMode ? false : isOpenNetwork(selected)), [manualMode, selected])
  const canOfflineRescan = wifiMode.apMode
  const displayedNetworks = useMemo(() => {
    const list = Array.isArray(networks) ? [...networks] : []
    return list.sort((a, b) => {
      if (!!a?.in_use !== !!b?.in_use) return a?.in_use ? -1 : 1
      return Number(b?.signal || 0) - Number(a?.signal || 0)
    })
  }, [networks])

  const refreshAccessInfo = async () => {
    try {
      const status = await getWifiStatus()
      // 네트워크 게이트(hooks/useNetworkGate)가 보는 판정도 같은 응답에서 나온다 — 여기서 갱신해
      // Wi-Fi 를 붙인 순간 게이트가 함께 풀리도록 한다(재조회 없이 값만 알린다).
      publishRobotOnline(deriveRobotOnline(status))
      const wifiUrl = status?.wifi_url || buildWifiUrl(status?.wifi_ip || status?.ipv4)
      setAccessUrls({
        lan: status?.lan_url || FIXED_ACCESS_URLS.lan,
        ap: status?.ap_url || FIXED_ACCESS_URLS.ap,
        wifi: wifiUrl
      })
      setWifiModeStatus({
        mode: status?.mode,
        label: status?.mode_label,
        sta_iface: status?.sta_iface,
        ap_iface: status?.ap_iface,
        wifi_ip: status?.wifi_ip || normalizeIp(status?.ipv4)
      })
      return status
    } catch (e) {
      try {
        const status = await getWifiModeStatus()
        setWifiModeStatus(status)
        setAccessUrls({
          lan: status?.lan_url || FIXED_ACCESS_URLS.lan,
          ap: status?.ap_url || FIXED_ACCESS_URLS.ap,
          wifi: status?.wifi_url || buildWifiUrl(status?.wifi_ip)
        })
        return status
      } catch (ignored) {
        return null
      }
    }
  }

  // Wi-Fi 주소는 로봇이 실제로 외부 Wi-Fi에 연결돼 있을 때만 의미가 있다.
  // 단일 AP 모드(혹은 상태 미확인)에서는 stale 한 wifi_ip 를 노출하지 않는다.
  const wifiConnected = useMemo(() => {
    const mode = wifiModeStatus?.mode
    return !!accessUrls.wifi && (mode === 'single_wifi' || mode === 'concurrent')
  }, [wifiModeStatus, accessUrls])

  const accessText = useMemo(
    () => [
      t('network.access.wired', { address: accessUrls.lan.replace(/^https?:\/\//, '') }),
      t('network.access.ap', { address: accessUrls.ap.replace(/^https?:\/\//, '') }),
      wifiConnected
        ? t('network.access.wifi', { address: accessUrls.wifi.replace(/^https?:\/\//, '') })
        : t('network.access.wifiDisconnected')
    ],
    [accessUrls, wifiConnected, t]
  )

  const handleScan = async (options = {}) => {
    const { preserveSelection = false, preserveConnectionNotice = false } = options

    setLoading(true)
    setScanMessage(t('network.loadingNetworks'))

    try {
      const res = await scanWifi()

      if (res.success) {
        const list = Array.isArray(res.networks) ? res.networks : []
        setNetworks(list)

        if (!preserveSelection) {
          setSelected(null)
          setManualMode(false)
          setManualSsid('')
          setManualHidden(false)
          setPassword('')
          setShowPassword(false)
        }

        if (!preserveConnectionNotice) {
          setConnectionNotice('')
          setConnectionState('idle')
        }

        setWifiMode({
          apMode: !!res.ap_mode,
          cached: !!res.cached,
          method: res.method || '-',
          iface: res.iface || '-'
        })

        const method = res.method || 'unknown'
        const iface = res.iface || '-'
        const cacheText = res.cached ? t('network.cachedSuffix') : ''
        const warning = res.warning ? ` · ${res.warning}` : ''
        setScanMessage(t('network.scanResult', { count: list.length, method, iface, cache: cacheText, warning }))
        refreshAccessInfo()
        return res
      }

      const message = res.error || t('network.scanFailed')
      setScanMessage(message)
      return res
    } catch (e) {
      const message = t('network.scanError', { message: e?.message || e })
      setScanMessage(message)
      return { success: false, error: message, networks: [] }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    handleScan()
    refreshAccessInfo()
  }, [])

  const verifyNormalWifiConnection = async (ssidToConnect) => {
    for (let attempt = 1; attempt <= CONNECTION_VERIFY_ATTEMPTS; attempt += 1) {
      setConnectionState('verifying')
      setConnectMessage(
        t('network.connect.verifying', { ssid: ssidToConnect, attempt, total: CONNECTION_VERIFY_ATTEMPTS })
      )
      setConnectionNotice(
        t('network.connect.verifying', { ssid: ssidToConnect, attempt, total: CONNECTION_VERIFY_ATTEMPTS })
      )

      await sleep(CONNECTION_VERIFY_DELAY_MS)
      const scanResult = await handleScan({
        preserveSelection: true,
        preserveConnectionNotice: true
      })
      const connected = findConnectedNetwork(scanResult?.networks, ssidToConnect)

      if (connected) {
        return connected
      }
    }

    return null
  }

  const handleConnect = async () => {
    const ssidToConnect = targetSsid.trim()
    if (!ssidToConnect || connecting) return

    const reconnectUrl = getDefaultReconnectUrl()
    const isApToStaSwitch = !!wifiMode.apMode

    setNextUrl(reconnectUrl)
    setConnecting(true)
    setShowSwitchingGuide(isApToStaSwitch)
    setConnectionNotice('')
    setConnectionState(isApToStaSwitch ? 'switching' : 'requesting')

    let timer = null

    if (isApToStaSwitch) {
      setCountdown(10)
      setConnectMessage(t('network.connect.switchStart'))

      let c = 10
      timer = setInterval(() => {
        c -= 1
        setCountdown(c)
        if (c <= 0) clearInterval(timer)
      }, 1000)
    } else {
      setConnectMessage(t('network.connect.requesting', { ssid: selectedName }))
      setConnectionNotice(t('network.connect.requestingWait', { ssid: selectedName }))
    }

    try {
      const res = await connectWifi(ssidToConnect, password, manualMode && manualHidden)

      if (!res?.success) {
        throw new Error(res?.error || t('network.connect.failed'))
      }

      if (isApToStaSwitch) {
        const next = res.next_url || reconnectUrl
        setNextUrl(next)
        setConnectMessage(t('network.connect.switchStarted'))
        return
      }

      setConnectionState('verifying')
      setConnectMessage(t('network.connect.requestSent', { ssid: selectedName }))
      setConnectionNotice(t('network.connect.requestSent', { ssid: selectedName }))

      const connected = await verifyNormalWifiConnection(ssidToConnect)

      if (connected) {
        setConnectionState('connected')
        setConnectMessage(t('network.connect.confirmed', { ssid: connected.ssid || ssidToConnect }))
        setConnectionNotice(t('network.connect.confirmedHint', { ssid: connected.ssid || ssidToConnect }))
        // 접속 주소와 함께 네트워크 게이트 판정도 갱신한다(로그인 전 진입이면 이때 게이트가 풀린다).
        await refreshAccessInfo()
      } else {
        setConnectionState('pending')
        setConnectMessage(t('network.connect.pending', { ssid: selectedName }))
        setConnectionNotice(t('network.connect.pendingPassword', { ssid: selectedName }))
      }
    } catch (e) {
      console.warn('Wi‑Fi 연결 요청 실패:', e)

      if (isApToStaSwitch) {
        setConnectMessage(t('network.connect.switchInterrupted'))
        return
      }

      setConnectionState('failed')
      setConnectMessage(t('network.connect.error', { message: e?.message || e }))
      setConnectionNotice(t('network.connect.error', { message: e?.message || e }))
    } finally {
      if (timer && !isApToStaSwitch) clearInterval(timer)
      if (!isApToStaSwitch) {
        setConnecting(false)
        setShowSwitchingGuide(false)
      }
    }
  }

  const handleOfflineRescan = async () => {
    if (connecting || !canOfflineRescan) return

    setConnecting(true)
    setShowSwitchingGuide(true)
    setCountdown(15)
    setConnectMessage(t('network.scan.offlineMessage'))

    let c = 15
    const timer = setInterval(() => {
      c -= 1
      setCountdown(c)
      if (c <= 0) clearInterval(timer)
    }, 1000)

    try {
      await rescanWifiOffline()
    } catch (e) {
      // AP 중지 시점에 fetch가 끊기는 것이 정상일 수 있다.
      console.warn('오프라인 재스캔 요청 중 연결이 끊겼을 수 있습니다:', e)
    } finally {
      window.setTimeout(() => {
        setConnecting(false)
        setShowSwitchingGuide(false)
        handleScan()
      }, 18000)
    }
  }

  const handleDisconnect = async () => {
    if (connecting) return

    const ok = window.confirm(t('network.disconnect.confirm'))
    if (!ok) return

    setConnecting(true)
    setConnectionState('idle')
    setConnectMessage(t('network.disconnect.requested'))
    setConnectionNotice(t('network.disconnect.requestedHint'))

    try {
      const res = await disconnectWifi()
      setConnectMessage(t('network.disconnect.requested'))
      setConnectionNotice(t('network.disconnect.reconnectHint'))
    } catch (e) {
      // 해제 순간 현재 요청 연결이 끊기는 것은 정상일 수 있다.
      console.warn('Wi‑Fi 연결 해제 요청 중 연결이 끊겼을 수 있습니다:', e)
      setConnectMessage(t('network.disconnect.interrupted'))
    } finally {
      window.setTimeout(() => {
        setConnecting(false)
        refreshAccessInfo()
        handleScan()
      }, 6000)
    }
  }

  // 이 화면은 설치 단계가 아니라 언제든 열 수 있는 Wi-Fi 설정이다(routes.jsx SETUP_GROUP.NETWORK) —
  // 그래서 단계 진행(currentStep)을 건드리지 않는다. 건드리면 뒷 단계를 밟던 로봇이 앞 단계로
  // 되돌아가 열려 있던 화면이 다시 잠긴다.
  // '/' 로 보내면 RootGuard 가 네트워크 · 세션을 다시 판정해 /login 또는 진행 중인 단계로 보낸다.
  const handleDone = () => {
    navigate('/')
  }

  const handleSwitchWifiMode = async (mode) => {
    if (connecting || modeChanging) return

    const isConcurrent = mode === 'concurrent'
    const ok = window.confirm(isConcurrent ? t('network.mode.confirmConcurrent') : t('network.mode.confirmSingle'))
    if (!ok) return

    setModeChanging(true)
    setModeMessage(isConcurrent ? t('network.mode.changingConcurrent') : t('network.mode.changingSingle'))

    try {
      const res = await switchWifiMode(mode)
      const label =
        res?.status?.label || (isConcurrent ? t('network.mode.concurrentLabel') : t('network.mode.singleLabel'))
      setModeMessage(t('network.mode.changed', { label }))
      await refreshAccessInfo()
      await handleScan({ preserveSelection: true, preserveConnectionNotice: true })
    } catch (e) {
      setModeMessage(t('network.mode.failed', { message: e?.message || e }))
    } finally {
      setModeChanging(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('network.title')}</HeroTitle>
            <HeroDescription>{t('network.description')}</HeroDescription>
          </HeroText>

          {/* 배지와 그 상태를 바꾸는 동작을 같은(오른쪽) 열에 세로로 둔다 — 배지 줄에 나란히 두면
              버튼도 배지처럼 알약 모양이어야 해서 상태 표시와 동작이 구분되지 않았다. 헤더 구분선
              (PageHero border-bottom) 위, 제목 줄과 같은 높이에 붙여 둔다. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.8rem' }}>
            <BadgeGroup>
              <StatusBadge tone={wifiMode.apMode ? 'blue' : 'green'}>
                {wifiMode.apMode ? t('network.badges.apConnected') : t('network.badges.wifiConnected')}
              </StatusBadge>
            </BadgeGroup>

            {wifiConnected && (
              <ActionButton onClick={handleDisconnect} disabled={connecting}>
                {connecting ? t('network.summary.processing') : t('network.summary.disconnect')}
              </ActionButton>
            )}
          </div>
        </PageHero>

        {/* 로그인 전 진입 안내. 로그인은 브라우저 → 클라우드 직통이라 로봇이 외부 Wi-Fi 에 붙어야
            하고, 노트북이 로봇 AP 에 붙어 있는 상태에서는 붙인 뒤 같은 Wi-Fi 로 옮겨 재접속해야
            로그인이 된다 — 접속 주소는 위 '접속 주소 안내' 카드에 표시된다. */}
        {!hasSession && (
          <ConnectPanel>
            <ConnectPanelTop>
              <div>
                <h3>{t('network.gate.title')}</h3>
                <p>{t('network.gate.description')}</p>
              </div>
              <StatusBadge tone="orange">{t('network.gate.badge')}</StatusBadge>
            </ConnectPanelTop>
          </ConnectPanel>
        )}

        <SummaryGrid>
          <SummaryCard>
            <SummaryLabel>{t('network.access.title')}</SummaryLabel>
            <SummaryValue accent as="div" style={{ lineHeight: 1.65 }}>
              {accessText.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </SummaryValue>
            <SummaryHint>{t('network.access.hint')}</SummaryHint>
          </SummaryCard>
        </SummaryGrid>

        <ConnectPanel>
          <ConnectPanelTop>
            <div>
              <h3>{t('network.mode.title')}</h3>
              <p>{t('network.mode.description')}</p>
              {/* 이 페이지 맨 아래 혼자 떨어져 있던 문구 — "AP→일반 Wi‑Fi 전환 시 끊김" 은 지금
                  단일/동시 모드를 고르는 이 패널과 같은 이야기다. 그 맥락 옆에 둔다. */}
              <SmallNote style={{ marginTop: '0.8rem' }}>{t('network.note')}</SmallNote>
            </div>
            {/* 배지가 "현재 방식" 을 대신 보여준다 — 문장과 배지 두 곳에서 같은 상태를 중복해서
                말하지 않는다. 백엔드가 준 사람이 읽을 label 을 우선하고, 없으면 원시 mode 값을
                modeBadgeLabel 로 사람이 읽을 말로 바꾼다. */}
            <StatusBadge
              tone={
                wifiModeStatus?.mode === 'concurrent' ? 'green' : wifiModeStatus?.mode === 'single_ap' ? 'blue' : 'gray'
              }
            >
              {wifiModeStatus?.label || modeBadgeLabel(wifiModeStatus?.mode, t)}
            </StatusBadge>
          </ConnectPanelTop>
          <ButtonWrap>
            <ActionButton onClick={() => handleSwitchWifiMode('concurrent')} disabled={connecting || modeChanging}>
              {t('network.mode.concurrentButton')}
            </ActionButton>
            <ActionButton onClick={() => handleSwitchWifiMode('single')} disabled={connecting || modeChanging}>
              {t('network.mode.singleButton')}
            </ActionButton>
            <ActionButton onClick={refreshAccessInfo} disabled={connecting || modeChanging}>
              {t('network.mode.refresh')}
            </ActionButton>
          </ButtonWrap>
          {modeMessage && <SmallNote style={{ marginTop: '1.2rem' }}>{modeMessage}</SmallNote>}
        </ConnectPanel>

        <SectionCard>
          <SectionHeader>
            <div>
              <SectionTitle>{t('network.scan.title')}</SectionTitle>
              <SectionDescription>
                {scanMessage}{' '}
                {/* 이 배지는 연결 상태가 아니라 지금 보이는 목록이 방금 새로 스캔한 것인지, 저장된
                    캐시인지를 말한다 — 그 목록을 설명하는 문장(scanMessage) 바로 옆이 맞는 자리다. */}
                <StatusBadge tone={wifiMode.cached ? 'orange' : 'green'}>
                  {wifiMode.cached ? t('network.badges.cached') : t('network.badges.realtime')}
                </StatusBadge>
              </SectionDescription>
            </div>

            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <ActionButton onClick={handleScan} disabled={loading || connecting}>
                {loading && <Spinner $size="1.3rem" style={{ marginRight: '0.6rem' }} />}
                {loading ? t('network.scan.scanning') : t('network.scan.rescan')}
              </ActionButton>
              {canOfflineRescan && (
                <ActionButton onClick={handleOfflineRescan} disabled={connecting}>
                  {t('network.scan.offlineRescan')}
                </ActionButton>
              )}
            </div>
          </SectionHeader>

          {/* 아직 보여줄 목록이 없는 첫 로딩 — "검색 결과 없음"(EmptyState)과 헷갈리지 않게
              찾고 있는 중이라는 것을 스피너로 보여준다. */}
          {networks.length === 0 && loading && (
            <WifiLoadingState>
              <Spinner $size="2.4rem" />
              <span>{t('network.loadingNetworks')}</span>
            </WifiLoadingState>
          )}

          {networks.length === 0 && !loading && (
            <EmptyState>
              <EmptyIcon>📶</EmptyIcon>
              <h4>{t('network.scan.empty')}</h4>
              <p>{wifiMode.apMode ? t('network.scan.emptyAp') : t('network.scan.emptyWifi')}</p>
            </EmptyState>
          )}

          {networks.length > 0 && (
            // 이미 목록이 있는 채로 재스캔 중이면(loading) 목록을 비우지 않고 살짝 흐리게만 둔다 —
            // 매번 목록이 사라졌다 나타나면 방금 고른 카드를 다시 찾아야 한다.
            <WifiGrid style={loading ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
              {displayedNetworks.map((network, idx) => {
                const active = selected?.ssid === network.ssid
                const bars = getSignalBars(network.signal)

                return (
                  <WifiCard key={`${network.ssid}-${idx}`} className={active ? 'active' : ''}>
                    <WifiCardRow
                      onClick={() => {
                        if (!connecting) {
                          setSelected(network)
                          setManualMode(false)
                          setManualSsid('')
                          setManualHidden(false)
                          setPassword('')
                        }
                      }}
                    >
                      <WifiMain>
                        <WifiNameRow>
                          <WifiName>{network.ssid || t('network.hiddenNetwork')}</WifiName>
                          {network.in_use && <WifiChip tone="green">{t('network.badges.current')}</WifiChip>}
                          {active && <WifiChip tone="blue">{t('network.badges.selected')}</WifiChip>}
                        </WifiNameRow>

                        <WifiMeta>
                          <WifiChip>{t('network.scan.security', { value: network.security || 'OPEN' })}</WifiChip>
                          <WifiChip>{t('network.scan.signalValue', { value: network.signal ?? 0 })}</WifiChip>
                          <WifiChip>{getSignalLabel(network.signal, t)}</WifiChip>
                        </WifiMeta>
                      </WifiMain>

                      <SignalBars aria-label={`signal ${network.signal}%`}>
                        {[1, 2, 3, 4].map((n) => (
                          <SignalBar key={n} className={n <= bars ? 'on' : ''} height={n} />
                        ))}
                      </SignalBars>
                    </WifiCardRow>

                    {/* 비밀번호 입력 + 연결 버튼만 — 타이틀/설명은 카드 자체가 이미 어느 Wi-Fi 인지
                        보여주므로 중복이다. 카드 안에 이어붙여 선택과 입력이 한눈에 붙어 보이게 한다. */}
                    {active && !manualMode && !connecting && (
                      <WifiConnectInline>
                        {!selectedIsOpen && (
                          <PasswordField>
                            <PasswordInput
                              type={showPassword ? 'text' : 'password'}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder={t('network.connect.passwordPlaceholder')}
                              autoComplete="current-password"
                            />
                            <TogglePasswordButton
                              type="button"
                              onClick={() => setShowPassword((value) => !value)}
                              aria-label={
                                showPassword ? t('network.connect.hidePassword') : t('network.connect.showPassword')
                              }
                              title={
                                showPassword ? t('network.connect.hidePassword') : t('network.connect.showPassword')
                              }
                            >
                              {showPassword ? '🙈' : '👁️'}
                            </TogglePasswordButton>
                          </PasswordField>
                        )}

                        <ButtonWrap className="alignRight">
                          <ActionButton onClick={handleConnect} disabled={!selectedIsOpen && !password}>
                            {t('network.connect.start')}
                          </ActionButton>
                        </ButtonWrap>
                      </WifiConnectInline>
                    )}
                  </WifiCard>
                )
              })}
            </WifiGrid>
          )}
        </SectionCard>

        {!connecting && (
          <ConnectPanel>
            <ConnectPanelTop>
              <div>
                <h3>{t('network.manual.title')}</h3>
                <p>{t('network.manual.description')}</p>
              </div>
              <StatusBadge tone={manualMode ? 'blue' : 'gray'}>
                {manualMode ? t('network.manual.selected') : 'Fallback'}
              </StatusBadge>
            </ConnectPanelTop>

            <ManualGrid>
              <div>
                <ManualLabel>SSID</ManualLabel>
                <PasswordInput
                  type="text"
                  value={manualSsid}
                  onChange={(e) => {
                    setManualSsid(e.target.value)
                    setManualMode(true)
                    setSelected(null)
                  }}
                  onFocus={() => setManualMode(true)}
                  placeholder={t('network.manual.ssidPlaceholder')}
                  autoComplete="off"
                />
              </div>
              <div>
                <ManualLabel>{t('network.manual.password')}</ManualLabel>
                <PasswordField>
                  <PasswordInput
                    type={showPassword ? 'text' : 'password'}
                    value={manualMode ? password : ''}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setManualMode(true)
                      setSelected(null)
                    }}
                    onFocus={() => setManualMode(true)}
                    placeholder={t('network.manual.passwordPlaceholder')}
                    autoComplete="current-password"
                  />
                  <TogglePasswordButton
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? t('network.connect.hidePassword') : t('network.connect.showPassword')}
                    title={showPassword ? t('network.connect.hidePassword') : t('network.connect.showPassword')}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </TogglePasswordButton>
                </PasswordField>
              </div>
            </ManualGrid>

            <div
              style={{
                marginTop: '1.2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap'
              }}
            >
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  color: '#667085',
                  fontSize: '1.25rem',
                  fontWeight: 800
                }}
              >
                <input
                  type="checkbox"
                  checked={manualHidden}
                  onChange={(e) => {
                    setManualHidden(e.target.checked)
                    setManualMode(true)
                    setSelected(null)
                  }}
                />
                {t('network.manual.hidden')}
              </label>
              <ButtonWrap className="alignRight">
                <ActionButton onClick={handleConnect} disabled={!manualSsid.trim()}>
                  {t('network.manual.connect')}
                </ActionButton>
              </ButtonWrap>
            </div>
          </ConnectPanel>
        )}

        {connectionNotice && !showSwitchingGuide && !connecting && (
          <ConnectPanel>
            <ConnectPanelTop>
              <div>
                <h3>{t('network.status.title')}</h3>
                <p>{connectionNotice}</p>
              </div>
              <StatusBadge
                tone={connectionState === 'failed' ? 'red' : connectionState === 'connected' ? 'green' : 'orange'}
              >
                {connectionState === 'connected'
                  ? t('network.status.connected')
                  : connectionState === 'failed'
                    ? t('network.status.failed')
                    : t('network.status.check')}
              </StatusBadge>
            </ConnectPanelTop>
          </ConnectPanel>
        )}

        {connecting && !showSwitchingGuide && (
          <SwitchingPanel>
            <SwitchingIcon>📶</SwitchingIcon>
            <SwitchingContent>
              <span>Wi‑Fi Connecting</span>
              <h3>{t('network.status.connecting')}</h3>
              <p>{connectMessage || connectionNotice}</p>

              <ReconnectBox>
                <span>{t('network.status.progress')}</span>
                <ReconnectLink as="div">
                  {connectionState === 'requesting' ? t('network.status.sending') : t('network.status.verifying')}
                </ReconnectLink>
              </ReconnectBox>

              <CountdownPill>{t('network.status.locked')}</CountdownPill>
            </SwitchingContent>
          </SwitchingPanel>
        )}

        {connecting && showSwitchingGuide && (
          <SwitchingPanel>
            <SwitchingIcon>📡</SwitchingIcon>
            <SwitchingContent>
              <span>Network Switching</span>
              <h3>{t('network.status.switching')}</h3>
              <p>{connectMessage}</p>

              <ReconnectBox>
                <span>{t('network.status.reconnect')}</span>
                <ReconnectLink as="div" style={{ textDecoration: 'none' }}>
                  {accessText.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </ReconnectLink>
              </ReconnectBox>

              <CountdownPill>{t('network.status.remaining', { seconds: countdown })}</CountdownPill>
            </SwitchingContent>
          </SwitchingPanel>
        )}
        {/* 설치 단계가 아니므로 '이전/다음' 대신 나가기 버튼 하나만 둔다 —
            로그인 전이면 로그인으로, 로그인 후면 진행 중인 단계로 되돌아간다('/' 판정: RootGuard). */}
        <WizardButtonWrap style={{ width: 'min(82rem, 100%)' }}>
          <ActionButton type="button" onClick={handleDone} disabled={connecting || modeChanging}>
            {hasSession ? t('common.complete') : t('network.gate.next')}
          </ActionButton>
        </WizardButtonWrap>
      </Section>
    </StyledPageContent>
  )
}

export default Network
