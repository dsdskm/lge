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
  RadioLine,
  FormRow,
  FormLabel,
  FormInput,
  ActionButton,
  SecondaryActionButton,
  WizardButtonWrap,
  ErrorText
} from './styles'
import { saveSiteCode } from '@/apis/defaultSetup'
import { advanceSetupProgress, SETUP_STEP_KEYS } from '@/utils/setupProgress'

const DEFAULT_SITE_CODE = 'GRPBCCCC'
const SITE_CODE_RE = /^[A-Z0-9]{8}$/

const SiteCode = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  const [method, setMethod] = useState('manual')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleNext = async () => {
    const value = method === 'default' ? DEFAULT_SITE_CODE : code
    if (!SITE_CODE_RE.test(value)) {
      setErr(t('siteCode.validation'))
      return
    }

    setBusy(true)
    setErr('')
    try {
      await saveSiteCode({ method, code: value })
      await advanceSetupProgress(SETUP_STEP_KEYS.LOCATION)
      navigate('/location')
    } catch (e) {
      setErr(t('siteCode.lookupFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('siteCode.title')}</HeroTitle>
            <HeroDescription>{t('siteCode.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{t('siteCode.intro')}</SetupCardIntro>

          <RadioLine>
            <input
              type="radio"
              checked={method === 'manual'}
              onChange={() => setMethod('manual')}
            />
            {t('siteCode.manual')}
          </RadioLine>

          <FormRow>
            <FormLabel>{t('siteCode.label')}</FormLabel>
            <FormInput
              value={code}
              maxLength={8}
              disabled={method !== 'manual'}
              onFocus={() => setMethod('manual')}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder={t('siteCode.placeholder')}
            />
          </FormRow>

          <div style={{ margin: '2.4rem 0', borderTop: '1px solid var(--color-neutral-20)', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '50%', top: 0, transform: 'translate(-50%, -50%)', padding: '0 .9rem', background: 'var(--color-neutral-10)', color: 'var(--color-neutral-50)', fontSize: '1.2rem', fontWeight: 700 }}>{t('siteCode.or')}</span>
          </div>

          <RadioLine>
            <input
              type="radio"
              checked={method === 'default'}
              onChange={() => setMethod('default')}
            />
            {t('siteCode.default')}
          </RadioLine>

          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrap>
            <SecondaryActionButton type="button" onClick={() => navigate('/install-mode')} disabled={busy}>
              {t('common.previous')}
            </SecondaryActionButton>
            <ActionButton
              type="button"
              onClick={handleNext}
              disabled={busy || (method === 'manual' && !SITE_CODE_RE.test(code))}
            >
              {busy ? t('siteCode.lookingUp') : t('common.next')}
            </ActionButton>
          </WizardButtonWrap>
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default SiteCode
