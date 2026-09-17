import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Section } from '@repo/ui'
import i18n from '@/i18n'
import {
  StyledPageContent,
  PageHero,
  HeroText,
  HeroTitle,
  HeroDescription,
  SetupFormCard,
  SetupCardIntro,
  LanguageList,
  LanguageOption,
  LanguageRadio,
  LanguageBadge,
  LanguageText,
  LanguageName,
  LanguageSubName,
  ActionButton,
  WizardButtonWrapSingle,
  ErrorText
} from './styles'
import { list as listLanguages, update as updateLanguage } from '@/apis/languageApis'
import { advanceSetupProgress, SETUP_STEP_KEYS } from '@/utils/setupProgress'

// 목록 자체는 BE 언어 마스터(languages)에서 받아오고, 뱃지/부가 표기만 코드별로 보완한다.
// 미등록 코드는 언어 서브태그(ko-KR -> KO)를 뱃지로 쓰고 부가 표기는 코드를 그대로 노출한다.
const LANGUAGE_DISPLAY = {
  'ko-KR': { badge: 'KR', subName: '한국어' },
  'en-US': { badge: 'EN', subName: '영어' }
}

const toOption = (lang) => {
  const display = LANGUAGE_DISPLAY[lang.code] ?? {}
  return {
    id: lang.id,
    code: lang.code,
    name: lang.name || lang.code,
    badge: display.badge ?? lang.code.split('-')[0].toUpperCase(),
    subName: display.subName ?? lang.code
  }
}

// i18n 현재 언어에 가장 가까운 코드를 고른다 (정확 일치 -> 언어 서브태그 일치 -> 첫 항목).
const pickInitialCode = (options) => {
  const current = i18n.resolvedLanguage || i18n.language || ''
  const exact = options.find((option) => option.code === current)
  if (exact) return exact.code
  const base = current.split('-')[0]
  const partial = base && options.find((option) => option.code.split('-')[0] === base)
  return partial?.code ?? options[0]?.code ?? ''
}

const Language = () => {
  const navigate = useNavigate()
  const { t, i18n: reactI18n } = useTranslation('setup')
  const [options, setOptions] = useState([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await listLanguages()
      const next = (res?.data ?? []).filter((lang) => ['ko-KR', 'en-US'].includes(lang.code)).map(toOption)
      setOptions(next)
      // 이미 사용 가능(enabled)으로 저장된 언어가 있으면 그것을 우선 선택한다.
      const savedCode = (res?.data ?? []).find((lang) => lang.enabled)?.code
      setSelected(savedCode ?? pickInitialCode(next))
    } catch (e) {
      setErr(t('language.loadFailed', { message: e.message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  // 우측 상단 지구본에서 언어를 바꾸면 이 화면의 선택 상태도 즉시 따라간다.
  useEffect(() => {
    const currentCode = pickInitialCode(options)
    if (currentCode) setSelected(currentCode)
  }, [options, reactI18n.resolvedLanguage, reactI18n.language])

  const handleNext = async () => {
    setBusy(true)
    setErr('')
    try {
      // 선택한 언어만 사용 가능(enabled=true), 나머지는 false 로 내린다.
      for (const option of options) {
        await updateLanguage(option.id, { enabled: option.code === selected })
      }

      await i18n.changeLanguage(selected)
      window.localStorage.setItem('i18nextLng', selected)
      // 이 단계를 끝냈으므로 '작업 중인 단계' 를 다음 화면(설치 모드 선택)으로 옮긴다.
      // 모드를 고르기 전까지는 뒤 단계 목록이 정해지지 않으므로 여기서는 항상 모드 선택이 다음이다.
      // (네트워크 설정은 설치 단계에서 빠져 헤더 Wi-Fi 아이콘으로만 들어간다 — routes.jsx)
      await advanceSetupProgress(SETUP_STEP_KEYS.INSTALL_MODE)
      navigate('/install-mode')
    } catch (e) {
      setErr(t('language.saveFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('language.title')}</HeroTitle>
            <HeroDescription>{t('language.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{loading ? t('language.loading') : t('language.intro')}</SetupCardIntro>

          <LanguageList>
            {options.map((language) => {
              const active = selected === language.code
              return (
                <LanguageOption
                  key={language.id}
                  type="button"
                  $active={active}
                  onClick={async () => {
                    setSelected(language.code)
                    await reactI18n.changeLanguage(language.code)
                    window.localStorage.setItem('i18nextLng', language.code)
                  }}
                  aria-pressed={active}
                >
                  <LanguageRadio $active={active} aria-hidden="true" />
                  <LanguageBadge $active={active}>{language.badge}</LanguageBadge>
                  <LanguageText>
                    <LanguageName>{language.code === 'ko-KR' ? '한국어' : 'English'}</LanguageName>
                    <LanguageSubName>{language.code === 'ko-KR' ? t('language.korean') : t('language.english')}</LanguageSubName>
                  </LanguageText>
                </LanguageOption>
              )
            })}
          </LanguageList>

          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrapSingle>
            <ActionButton type="button" onClick={handleNext} disabled={busy || loading || !selected}>
              {busy ? t('common.saving') : t('common.next')}
            </ActionButton>
          </WizardButtonWrapSingle>
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default Language
