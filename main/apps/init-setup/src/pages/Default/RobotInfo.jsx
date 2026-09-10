import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Section } from '@repo/ui'
import {
  StyledPageContent,
  PageHero,
  HeroText,
  HeroTitle,
  HeroDescription,
  SetupFormCard,
  SetupCardIntro,
  FormRow,
  FormLabel,
  FormInput,
  ActionButton,
  SecondaryActionButton,
  WizardButtonWrap,
  InfoText,
  ErrorText
} from './styles'
import { saveRobotInfo } from '@/apis/defaultSetup'
import { advanceSetupProgress, SETUP_STEPS } from '@/utils/setupProgress'

const RobotInfo = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleComplete = async () => {
    const robotName = name.trim()
    if (!robotName) return

    setBusy(true)
    setErr('')
    try {
      const response = await saveRobotInfo({ robot_name: robotName })
      if (response?.registered === false) throw new Error('registration_failed')
      await advanceSetupProgress(SETUP_STEPS.MAP_SCAN)
      // 맵 설정 그룹의 입구로 보낸다 — '/download' 은 화면이 없는 부모 경로라 그룹 첫 화면으로
      // 리다이렉트된다(router/routes.jsx mapIndex).
      navigate('/download', { replace: true })
      window.location.reload()
    } catch (e) {
      setErr(t('robotInfo.registerFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('robotInfo.title')}</HeroTitle>
            <HeroDescription>{t('robotInfo.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{t('robotInfo.intro')}</SetupCardIntro>

          <FormRow>
            <FormLabel>{t('robotInfo.name')}</FormLabel>
            <FormInput
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('robotInfo.placeholder')}
            />
            <InfoText>{name.length}/20</InfoText>
          </FormRow>

          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrap>
            <SecondaryActionButton type="button" onClick={() => navigate('/location')} disabled={busy}>
              {t('common.previous')}
            </SecondaryActionButton>
            <ActionButton type="button" onClick={handleComplete} disabled={busy || !name.trim()}>
              {busy ? t('robotInfo.registering') : t('common.complete')}
            </ActionButton>
          </WizardButtonWrap>
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default RobotInfo
