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
  FormSelect,
  InfoText,
  ErrorText,
  SmallNote,
  MiniButton,
  ActionButton,
  SecondaryActionButton,
  WizardButtonWrap
} from '@/pages/Default/styles'
import { list as listBuildings } from '@/apis/buildingApis'
import { list as listFloors } from '@/apis/floorApis'
import { list as listAreas } from '@/apis/areaApis'
import { finishMigration, remapMap, startMigration } from '@/apis/migrationApis'
import useMigration from '@/hooks/useMigration'
import { clearLocalSession } from '@/utils/session'

/**
 * 단독 설치 → 관제 연동 전환 화면.
 *
 * 단독 설치로 만든 맵은 로컬 위치 계층('LOCAL-' 행)에 매달려 있어 그대로는 관제로 올릴 수 없다 —
 * 업로드가 쓰는 식별자가 관제 extId 이기 때문이다(init-setup-be mapUpload.service). 이 화면이
 * 그 재매핑을 담당하고, 앞뒤 단계(Wi-Fi · 로그인 · 지점 코드 · 계층 받기 · 업로드)는 관제 연동
 * 설치의 기존 화면을 그대로 쓴다 — 전환을 시작하면 그 화면들이 다시 열린다(App.jsx).
 *
 * 그래서 이 화면은 '지금 무엇을 해야 하는지' 를 상태로 판단해 보여준다:
 *   available  전환 전(단독)        → 전환 시작 버튼
 *   active + 관제 사이트 없음       → 지점 코드까지 먼저 하라는 안내 + 그 화면들로 가는 버튼
 *   active + 옮길 맵 있음           → 맵별 건물/층/구역 지정
 *   active + 옮길 맵 없음(canFinish) → 로컬 장소 정리 + 업로드로 이동
 */

/** 관제에서 받은 행만 남긴다 — 'LOCAL-' 접두사는 단독 설치가 만든 로컬 계층이다. */
const isCloudRow = (row) => !String(row?.extId ?? '').startsWith('LOCAL-')

const nameOf = (row) => row?.name?.default ?? String(row?.extId ?? '')

const Migration = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('setup')
  const { loading, available, active, canFinish, cloudSite, maps, refresh } = useMigration()
  // 관제 계층(건물 > 층 > 구역)은 한 번에 받아 화면에서만 쓴다 — 목록이 작고, 행마다 조회하면
  // 맵 개수만큼 요청이 늘어난다.
  const [tree, setTree] = useState([])
  const [selection, setSelection] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const loadTree = useCallback(async () => {
    try {
      const buildingRes = await listBuildings()
      const buildings = (buildingRes?.data ?? [])
        .filter(isCloudRow)
        .filter((row) => !cloudSite || String(row.siteId) === String(cloudSite.id))

      const next = await Promise.all(
        buildings.map(async (building) => {
          const floorRes = await listFloors({ buildingId: building.id })
          const floors = await Promise.all(
            (floorRes?.data ?? []).filter(isCloudRow).map(async (floor) => {
              const areaRes = await listAreas({ floorId: floor.id })
              return { ...floor, areas: (areaRes?.data ?? []).filter(isCloudRow) }
            })
          )
          return { ...building, floors }
        })
      )
      setTree(next)
    } catch (e) {
      setErr(t('migration.hierarchyFailed', { message: e.message }))
    }
  }, [cloudSite, t])

  useEffect(() => {
    if (active) loadTree()
  }, [active, loadTree])

  const pick = (mapId, next) => setSelection((prev) => ({ ...prev, [mapId]: { ...prev[mapId], ...next } }))

  const handleStart = async () => {
    setBusy(true)
    setErr('')
    try {
      await startMigration()
      // 단독 설치용 로컬 세션은 클라우드가 모르는 토큰이다 — 전환 뒤에는 실제 로그인을 거쳐야 하므로
      // 여기서 비운다(utils/session). 그러면 다음 화면 진입에서 로그인 화면으로 안내된다.
      clearLocalSession()
      // 설치 모드가 바뀌면 라우트·메뉴 구성이 달라지므로(App.jsx) 전체 리로드로 다시 그린다.
      window.location.assign('/migration')
    } catch (e) {
      setErr(t('migration.startFailed', { message: e.message }))
      setBusy(false)
    }
  }

  const handleRemap = async (map) => {
    const areaId = selection[map.id]?.areaId
    if (!areaId) {
      toast.warn(t('migration.pickArea'), { autoClose: 3000 })
      return
    }
    setBusy(true)
    setErr('')
    try {
      const res = await remapMap(map.id, areaId)
      toast.success(
        t('migration.remapped', { name: res?.map?.name?.default ?? map.name, poi: res?.pois?.remarked ?? 0 }),
        { autoClose: 3000 }
      )
      await refresh()
    } catch (e) {
      setErr(t('migration.remapFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  const handleFinish = async () => {
    setBusy(true)
    setErr('')
    try {
      await finishMigration()
      toast.success(t('migration.finished'), { autoClose: 3000 })
      // 정리가 끝나면 전환 상태가 꺼진다(로컬 계층이 사라진다) — 전환 메뉴 노출과 초기 설정 그룹
      // 유지가 App 진입 시점의 상태로 만들어지므로 전체 리로드로 업로드 화면으로 보낸다.
      window.location.assign('/upload')
    } catch (e) {
      setErr(t('migration.finishFailed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  const renderMapRow = (map) => {
    const selected = selection[map.id] ?? {}
    const building = tree.find((row) => String(row.id) === String(selected.buildingId))
    const floors = building?.floors ?? []
    const floor = floors.find((row) => String(row.id) === String(selected.floorId))
    const areas = floor?.areas ?? []

    return (
      <div key={map.id} style={{ marginTop: '2rem' }}>
        <SetupCardIntro>{map.name || `#${map.id}`}</SetupCardIntro>
        <SmallNote>{t('migration.currentPlace', { place: map.place || '-' })}</SmallNote>

        <FormRow>
          <FormLabel>{t('migration.building')}</FormLabel>
          <FormSelect
            value={selected.buildingId ?? ''}
            onChange={(e) => pick(map.id, { buildingId: e.target.value, floorId: '', areaId: '' })}
          >
            <option value="">{t('migration.selectBuilding')}</option>
            {tree.map((row) => (
              <option key={row.id} value={row.id}>
                {nameOf(row)}
              </option>
            ))}
          </FormSelect>
        </FormRow>

        <FormRow>
          <FormLabel>{t('migration.floor')}</FormLabel>
          <FormSelect
            value={selected.floorId ?? ''}
            disabled={!selected.buildingId}
            onChange={(e) => pick(map.id, { floorId: e.target.value, areaId: '' })}
          >
            <option value="">{t('migration.selectFloor')}</option>
            {floors.map((row) => (
              <option key={row.id} value={row.id}>
                {nameOf(row)}
              </option>
            ))}
          </FormSelect>
        </FormRow>

        <FormRow>
          <FormLabel>{t('migration.area')}</FormLabel>
          <FormSelect
            value={selected.areaId ?? ''}
            disabled={!selected.floorId}
            onChange={(e) => pick(map.id, { areaId: e.target.value })}
          >
            <option value="">{t('migration.selectArea')}</option>
            {areas.map((row) => (
              <option key={row.id} value={row.id}>
                {nameOf(row)}
              </option>
            ))}
          </FormSelect>
        </FormRow>

        <MiniButton type="button" onClick={() => handleRemap(map)} disabled={busy || !selected.areaId}>
          {t('migration.remap')}
        </MiniButton>
      </div>
    )
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('migration.title')}</HeroTitle>
            <HeroDescription>{t('migration.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          {loading && <SetupCardIntro>{t('migration.loading')}</SetupCardIntro>}

          {/* 전환 전 — 무엇이 열리고 무엇을 해야 하는지 알려주고 시작만 받는다. */}
          {!loading && available && (
            <>
              <SetupCardIntro>{t('migration.startIntro')}</SetupCardIntro>
              <InfoText>{t('migration.steps')}</InfoText>
              <InfoText>{t('migration.startHint')}</InfoText>
              <WizardButtonWrap>
                <ActionButton type="button" onClick={handleStart} disabled={busy}>
                  {busy ? t('common.applying') : t('migration.start')}
                </ActionButton>
              </WizardButtonWrap>
            </>
          )}

          {/* 전환 중 — 지점 코드까지 끝나지 않으면 옮길 대상 계층이 로컬 DB 에 없다. */}
          {!loading && active && !cloudSite && (
            <>
              <SetupCardIntro>{t('migration.needSiteIntro')}</SetupCardIntro>
              <InfoText>{t('migration.needSiteHint')}</InfoText>
              <WizardButtonWrap>
                <SecondaryActionButton type="button" onClick={() => navigate('/network')}>
                  {t('migration.goNetwork')}
                </SecondaryActionButton>
                <ActionButton type="button" onClick={() => navigate('/site-code')}>
                  {t('migration.goSiteCode')}
                </ActionButton>
              </WizardButtonWrap>
            </>
          )}

          {/* 전환 중 — 맵별 재매핑. */}
          {!loading && active && cloudSite && maps.length > 0 && (
            <>
              <SetupCardIntro>{t('migration.mapIntro', { count: maps.length })}</SetupCardIntro>
              <InfoText>{t('migration.mapHint')}</InfoText>
              {maps.map(renderMapRow)}
            </>
          )}

          {/* 전환 중 — 옮길 맵이 없다. 로컬 계층 정리 후 업로드로 넘어간다. */}
          {!loading && active && canFinish && (
            <>
              <SetupCardIntro>{t('migration.finishIntro')}</SetupCardIntro>
              <InfoText>{t('migration.finishHint')}</InfoText>
              <WizardButtonWrap>
                <SecondaryActionButton type="button" onClick={handleFinish} disabled={busy}>
                  {busy ? t('common.applying') : t('migration.finish')}
                </SecondaryActionButton>
                <ActionButton type="button" onClick={() => navigate('/upload')} disabled={busy}>
                  {t('migration.goUpload')}
                </ActionButton>
              </WizardButtonWrap>
            </>
          )}

          {!loading && !available && !active && <InfoText>{t('migration.nothing')}</InfoText>}

          {err && <ErrorText>{err}</ErrorText>}
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default Migration
