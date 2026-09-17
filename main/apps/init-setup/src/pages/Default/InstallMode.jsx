import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Modal, Section } from '@repo/ui'
import {
  StyledPageContent,
  PageHero,
  HeroText,
  HeroTitle,
  HeroDescription,
  SetupFormCard,
  SetupCardIntro,
  RadioLine,
  InfoText,
  ErrorText,
  ActionButton,
  SecondaryActionButton,
  WizardButtonWrap
} from './styles'
import { getInstallMode, saveInstallMode } from '@/apis/defaultSetup'
import { advanceSetupProgress, SETUP_STEP_KEYS } from '@/utils/setupProgress'
import { SETUP_MODE } from '@/utils/setupSteps'

/**
 * 설치 모드 선택 — 관제 연동 / 단독(Stand Alone).
 *
 * 이 선택이 뒤 단계 목록 자체를 바꾼다(utils/setupSteps STEP_ORDER, router/routes.jsx modes):
 * 단독 설치는 네트워크 게이트 · 로그인 · 사이트 코드 · 운영 위치 · 로봇명 등록 · 맵 다운로드/업로드가
 * 모두 빠지고, 위치 계층은 BE 가 만들어 주는 로컬 계층(Local/1F/Default)을 쓴다.
 *
 * 저장 후에는 같은 탭 안에서 navigate 하지 않고 다음 화면으로 '전체 리로드' 를 한다 —
 * 라우트 구성과 메뉴가 App 진입 시점의 모드로 만들어지므로(App.jsx visibleAppRoutes) 리로드 없이
 * 이동하면 방금 켜진 화면이 아직 라우트에 없어 catch-all 로 되튕긴다.
 */
/**
 * 모드를 정한 뒤 갈 화면.
 * 관제 연동은 다음 단계(지점 코드)부터 관제 왕복이 필요하므로 Wi-Fi 설정으로 먼저 보낸다 —
 * 네트워크 설정 화면의 '완료' 는 '/' 로 보내고, RootGuard 가 방금 기록한 진행 단계
 * (지점 코드)로 착지시킨다(pages/Default/Network.handleDone).
 */
const NEXT_PATH = {
  [SETUP_MODE.MANAGED]: '/network',
  [SETUP_MODE.STANDALONE]: '/local-place'
}

const NEXT_STEP = {
  [SETUP_MODE.MANAGED]: SETUP_STEP_KEYS.SITE_CODE,
  [SETUP_MODE.STANDALONE]: SETUP_STEP_KEYS.LOCAL_PLACE
}

const InstallMode = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  const [mode, setMode] = useState(SETUP_MODE.MANAGED)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    // 이미 고른 값이 있으면 그것을 선택 상태로 둔다(뒤로 돌아온 경우).
    getInstallMode()
      .then((res) => {
        if (res?.decided) setMode(res.mode)
      })
      .catch((e) => setErr(t('installMode.loadFailed', { message: e.message })))
  }, [t])

  const apply = async () => {
    setBusy(true)
    setErr('')
    try {
      await saveInstallMode(mode)
      // 단계 기록은 모드 저장 뒤에 한다 — 함께 저장하는 단계 번호가 '모드별 목록의 위치' 라서
      // 순서를 뒤집으면 이전 모드 기준으로 계산된다(utils/setupProgress.stepFields).
      await advanceSetupProgress(NEXT_STEP[mode])
      window.location.assign(NEXT_PATH[mode])
    } catch (e) {
      setErr(t('installMode.saveFailed', { message: e.message }))
      setBusy(false)
    }
  }

  const handleNext = () => {
    // 단독 설치는 관제 화면이 사라지고 되돌리려면 전환 작업이 필요하므로 한 번 확인한다.
    if (mode === SETUP_MODE.STANDALONE) {
      setConfirming(true)
      return
    }
    apply()
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('installMode.title')}</HeroTitle>
            <HeroDescription>{t('installMode.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{t('installMode.intro')}</SetupCardIntro>

          <RadioLine>
            <input
              type="radio"
              checked={mode === SETUP_MODE.MANAGED}
              onChange={() => setMode(SETUP_MODE.MANAGED)}
            />
            {t('installMode.managed')}
          </RadioLine>
          <InfoText>{t('installMode.managedHint')}</InfoText>

          <RadioLine>
            <input
              type="radio"
              checked={mode === SETUP_MODE.STANDALONE}
              onChange={() => setMode(SETUP_MODE.STANDALONE)}
            />
            {t('installMode.standalone')}
          </RadioLine>
          <InfoText>{t('installMode.standaloneHint')}</InfoText>

          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrap>
            <SecondaryActionButton type="button" onClick={() => navigate('/language')} disabled={busy}>
              {t('common.previous')}
            </SecondaryActionButton>
            <ActionButton type="button" onClick={handleNext} disabled={busy}>
              {busy ? t('common.applying') : t('common.next')}
            </ActionButton>
          </WizardButtonWrap>
        </SetupFormCard>
      </Section>

      {/* Modal 의 footer 는 children 개수로 버튼 폭을 계산한다 — 조건부 렌더를 섞지 않는다
          (components/SetupOrderModal 과 같은 규칙). */}
      <Modal
        isOpen={confirming}
        size="sm"
        title={t('installMode.confirmTitle')}
        onClose={() => setConfirming(false)}
        renderButtonComponent={
          <>
            <Button key="cancel" size="lg" theme="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              key="confirm"
              size="lg"
              onClick={() => {
                setConfirming(false)
                apply()
              }}
              disabled={busy}
            >
              {t('installMode.confirmOk')}
            </Button>
          </>
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.8rem',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            minHeight: '8rem',
            lineHeight: 1.5,
            width: '100%'
          }}
        >
          <div>{t('installMode.confirmBody')}</div>
          <div>{t('installMode.confirmHint')}</div>
        </div>
      </Modal>
    </StyledPageContent>
  )
}

export default InstallMode
