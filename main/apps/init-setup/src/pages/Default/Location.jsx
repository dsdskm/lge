import React, { useEffect, useMemo, useState } from 'react'
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
  FormSelect,
  ActionButton,
  SecondaryActionButton,
  WizardButtonWrap,
  InfoText,
  ErrorText
} from './styles'
import { getOperationLocation, saveOperationLocation } from '@/apis/defaultSetup'
import { advanceSetupProgress, SETUP_STEP_KEYS } from '@/utils/setupProgress'

const itemId = (item) => String(item?.id ?? item?.buildingId ?? item?.floorId ?? item?.areaId ?? '')
const itemName = (item) => item?.name ?? item?.buildingName ?? item?.floorName ?? item?.areaName ?? itemId(item)

const Location = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  const [buildings, setBuildings] = useState([])
  const [defaultSite, setDefaultSite] = useState(false)
  const [building, setBuilding] = useState('')
  const [floor, setFloor] = useState('')
  const [area, setArea] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setErr('')
    try {
      const response = await getOperationLocation()
      const data = response?.data ?? response ?? {}
      setBuildings(data?.options?.buildings ?? [])
      setDefaultSite(data?.site_code_method === 'default' && !!data?.site_id)
    } catch (e) {
      setErr(t('location.loadFailed', { message: e.message }))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const selectedBuilding = useMemo(
    () => buildings.find((item) => itemId(item) === building),
    [buildings, building]
  )
  const floors = selectedBuilding?.floors || []
  const selectedFloor = useMemo(
    () => floors.find((item) => itemId(item) === floor),
    [floors, floor]
  )
  const areas = selectedFloor?.areas || []
  const canContinue = defaultSite && buildings.length === 0
    ? true
    : !!building && !!floor && (areas.length === 0 || !!area)

  const handleNext = async () => {
    if (!canContinue) return
    setBusy(true)
    setErr('')
    try {
      await saveOperationLocation({ building, floor, area })
      await advanceSetupProgress(SETUP_STEP_KEYS.ROBOT_INFO)
      navigate('/robot-info')
    } catch (e) {
      setErr(t('location.saveFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('location.title')}</HeroTitle>
            <HeroDescription>{t('location.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{t('location.intro')}</SetupCardIntro>

          <FormRow>
            <FormLabel>{t('location.building')}</FormLabel>
            <FormSelect
              value={building}
              onChange={(e) => {
                setBuilding(e.target.value)
                setFloor('')
                setArea('')
              }}
            >
              <option value="">{t('location.selectBuilding')}</option>
              {buildings.map((item) => (
                <option key={itemId(item)} value={itemId(item)}>{itemName(item)}</option>
              ))}
            </FormSelect>
          </FormRow>

          <FormRow>
            <FormLabel>{t('location.floor')}</FormLabel>
            <FormSelect
              value={floor}
              disabled={!building}
              onChange={(e) => {
                setFloor(e.target.value)
                setArea('')
              }}
            >
              <option value="">{t('location.selectFloor')}</option>
              {floors.map((item) => (
                <option key={itemId(item)} value={itemId(item)}>{itemName(item)}</option>
              ))}
            </FormSelect>
          </FormRow>

          {areas.length > 0 && (
            <FormRow>
              <FormLabel>{t('location.area')}</FormLabel>
              <FormSelect value={area} disabled={!floor} onChange={(e) => setArea(e.target.value)}>
                <option value="">{t('location.selectArea')}</option>
                {areas.map((item) => (
                  <option key={itemId(item)} value={itemId(item)}>{itemName(item)}</option>
                ))}
              </FormSelect>
            </FormRow>
          )}

          {!err && buildings.length === 0 && (
            <InfoText>{defaultSite ? t('location.defaultSiteHint') : t('location.siteCodeHint')}</InfoText>
          )}
          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrap>
            <SecondaryActionButton type="button" onClick={() => navigate('/site-code')} disabled={busy}>
              {t('common.previous')}
            </SecondaryActionButton>
            <ActionButton type="button" onClick={handleNext} disabled={busy || !canContinue}>
              {busy ? t('common.applying') : t('common.next')}
            </ActionButton>
          </WizardButtonWrap>
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default Location
