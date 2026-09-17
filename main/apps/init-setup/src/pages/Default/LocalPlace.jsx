import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
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
  InfoText,
  ErrorText,
  ActionButton,
  SecondaryActionButton,
  MiniButton,
  WizardButtonWrap
} from './styles'
import { list as listSites } from '@/apis/siteApis'
import { list as listBuildings, update as updateBuilding } from '@/apis/buildingApis'
import { list as listFloors, create as createFloor, update as updateFloor } from '@/apis/floorApis'
import { list as listAreas, create as createArea, update as updateArea } from '@/apis/areaApis'
import { advanceSetupProgress, SETUP_STEP_KEYS } from '@/utils/setupProgress'

/**
 * 단독 설치의 위치 계층 화면.
 *
 * 관제 연동 설치는 사이트 코드 조회 · 맵 다운로드가 Building > Floor > Area 를 만들어 주지만
 * 단독 설치에는 그 경로가 없다. 대신 모드를 고르는 순간 BE 가 로컬 1세트(Local / 1F / Default)를
 * 만들어 두므로(init-setup-be localSite.service) 이 화면은 그것을 '현장 이름' 으로 고치고
 * 필요한 만큼 층·구역을 늘리는 일만 한다.
 *
 * 층·구역을 늘리는 것이 이 화면의 핵심이다 — 맵은 구역 단위로 저장되고 같은 구역에 다시 저장하면
 * 이전 작업본을 덮어쓰므로(components/ConnectionBar), 구역이 하나면 맵도 한 장만 만들 수 있다.
 *
 * 삭제는 두지 않는다 — 구역/층을 지우면 그 아래 맵과 POI 가 CASCADE 로 함께 사라진다
 * (init-setup-be models/area.js, floor.js). 잘못 만든 항목은 이름을 고쳐 쓰고, 정말 지워야 하면
 * 관리자 화면(DB 브라우저)에서 맵을 확인한 뒤 지운다.
 */

/** 로컬 계층에 새로 만드는 행의 외부 식별자 — 관제가 발급한 값과 구분되게 'LOCAL-' 접두사를 쓴다. */
const localExtId = (kind) => `LOCAL-${kind}-${Date.now()}`

const nameOf = (row) => row?.name?.default ?? ''

const LocalPlace = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  const [building, setBuilding] = useState(null)
  const [floors, setFloors] = useState([])
  const [areasByFloor, setAreasByFloor] = useState({})
  // 이름 입력값은 화면에서만 들고 있다가 '저장' 에서 한 번에 반영한다(행마다 저장 버튼을 두면
  // 어디까지 저장됐는지 알기 어렵다).
  const [names, setNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const sites = await listSites()
      const activeSite = (sites?.data ?? []).find((site) => site.isActive) ?? (sites?.data ?? [])[0]
      if (!activeSite) throw new Error('local site not found')

      const buildingRes = await listBuildings()
      const localBuilding = (buildingRes?.data ?? []).find((row) => String(row.siteId) === String(activeSite.id))
      if (!localBuilding) throw new Error('local building not found')

      const floorRes = await listFloors({ buildingId: localBuilding.id })
      const floorRows = floorRes?.data ?? []

      const areaEntries = await Promise.all(
        floorRows.map(async (floor) => {
          const areaRes = await listAreas({ floorId: floor.id })
          return [floor.id, areaRes?.data ?? []]
        })
      )

      const nextNames = { [`building:${localBuilding.id}`]: nameOf(localBuilding) }
      for (const floor of floorRows) nextNames[`floor:${floor.id}`] = nameOf(floor)
      for (const [, areas] of areaEntries) {
        for (const area of areas) nextNames[`area:${area.id}`] = nameOf(area)
      }

      setBuilding(localBuilding)
      setFloors(floorRows)
      setAreasByFloor(Object.fromEntries(areaEntries))
      setNames(nextNames)
    } catch (e) {
      setErr(t('localPlace.loadFailed', { message: e.message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const setName = (key, value) => setNames((prev) => ({ ...prev, [key]: value }))

  /** 이름이 바뀐 행만 저장한다. name 은 다국어 JSONB 라서 default 만 갈아끼운다. */
  const saveNames = async () => {
    const jobs = []
    if (building && names[`building:${building.id}`] !== nameOf(building)) {
      jobs.push(updateBuilding(building.id, { name: { ...building.name, default: names[`building:${building.id}`] } }))
    }
    for (const floor of floors) {
      const next = names[`floor:${floor.id}`]
      if (next !== nameOf(floor)) jobs.push(updateFloor(floor.id, { name: { ...floor.name, default: next } }))
    }
    for (const areas of Object.values(areasByFloor)) {
      for (const area of areas) {
        const next = names[`area:${area.id}`]
        if (next !== nameOf(area)) jobs.push(updateArea(area.id, { name: { ...area.name, default: next } }))
      }
    }
    await Promise.all(jobs)
    return jobs.length
  }

  const handleSave = async () => {
    setBusy(true)
    setErr('')
    try {
      const count = await saveNames()
      toast.success(t('localPlace.saved', { count }), { autoClose: 2000 })
      await load()
    } catch (e) {
      setErr(t('localPlace.saveFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  const handleAddFloor = async () => {
    setBusy(true)
    setErr('')
    try {
      // 새 층 이름/번호는 기존 최대값 다음으로 제안한다 — 어차피 아래 입력에서 고칠 수 있다.
      const nextIndex = Math.max(0, ...floors.map((floor) => Number(floor.floorIndex) || 0)) + 1
      const created = await createFloor({
        buildingId: building.id,
        extId: localExtId('FLOOR'),
        name: { default: `${nextIndex}F` },
        floorIndex: nextIndex
      })
      // 층만 만들면 그 층에는 맵을 저장할 수 없다(맵 소속은 구역이다) — 기본 구역을 함께 만든다.
      await createArea({
        floorId: created?.data?.id,
        extId: localExtId('AREA'),
        name: { default: 'Default' }
      })
      await load()
    } catch (e) {
      setErr(t('localPlace.addFloorFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  const handleAddArea = async (floor) => {
    setBusy(true)
    setErr('')
    try {
      const count = (areasByFloor[floor.id] ?? []).length + 1
      await createArea({
        floorId: floor.id,
        extId: localExtId('AREA'),
        name: { default: `Area ${count}` }
      })
      await load()
    } catch (e) {
      setErr(t('localPlace.addAreaFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  const handleNext = async () => {
    setBusy(true)
    setErr('')
    try {
      // 입력 중인 이름을 두고 넘어가면 맵 이름이 이전 값으로 만들어지므로 먼저 저장한다.
      await saveNames()
      await advanceSetupProgress(SETUP_STEP_KEYS.MAP_SCAN)
      navigate('/map/scan')
    } catch (e) {
      setErr(t('localPlace.saveFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('localPlace.title')}</HeroTitle>
            <HeroDescription>{t('localPlace.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{loading ? t('localPlace.loading') : t('localPlace.intro')}</SetupCardIntro>

          {building && (
            <FormRow>
              <FormLabel>{t('localPlace.building')}</FormLabel>
              <FormInput
                value={names[`building:${building.id}`] ?? ''}
                maxLength={40}
                onChange={(e) => setName(`building:${building.id}`, e.target.value)}
              />
            </FormRow>
          )}

          {floors.map((floor) => (
            <div key={floor.id} style={{ marginTop: '1.6rem' }}>
              <FormRow>
                <FormLabel>{t('localPlace.floor')}</FormLabel>
                <FormInput
                  value={names[`floor:${floor.id}`] ?? ''}
                  maxLength={40}
                  onChange={(e) => setName(`floor:${floor.id}`, e.target.value)}
                />
              </FormRow>

              {(areasByFloor[floor.id] ?? []).map((area) => (
                <FormRow key={area.id} style={{ paddingLeft: '2.4rem' }}>
                  <FormLabel>{t('localPlace.area')}</FormLabel>
                  <FormInput
                    value={names[`area:${area.id}`] ?? ''}
                    maxLength={40}
                    onChange={(e) => setName(`area:${area.id}`, e.target.value)}
                  />
                </FormRow>
              ))}

              <div style={{ paddingLeft: '2.4rem', marginTop: '0.6rem' }}>
                <MiniButton type="button" onClick={() => handleAddArea(floor)} disabled={busy}>
                  {t('localPlace.addArea')}
                </MiniButton>
              </div>
            </div>
          ))}

          <div style={{ marginTop: '1.6rem' }}>
            <MiniButton type="button" onClick={handleAddFloor} disabled={busy || !building}>
              {t('localPlace.addFloor')}
            </MiniButton>
          </div>

          <InfoText>{t('localPlace.hint')}</InfoText>
          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrap>
            <SecondaryActionButton type="button" onClick={handleSave} disabled={busy || loading}>
              {busy ? t('common.applying') : t('localPlace.save')}
            </SecondaryActionButton>
            <ActionButton type="button" onClick={handleNext} disabled={busy || loading || !building}>
              {busy ? t('common.applying') : t('common.next')}
            </ActionButton>
          </WizardButtonWrap>
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default LocalPlace
