import React, { useCallback, useEffect, useState } from 'react'
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
  RadioLine,
  InfoText,
  ErrorText,
  SmallNote,
  ActionButton,
  WizardButtonWrapSingle
} from '@/pages/Default/styles'
import * as mapApi from '@/apis/mapApis'
import * as poiApi from '@/apis/mapPoiApis'
import { completeSetup } from '@/utils/setupProgress'
import { isWorkingMapDir, resolveMapDir, visibleMaps } from '@/utils/mapRecord'

/**
 * 설치 완료 화면 — 단독 설치의 마지막 단계.
 *
 * 관제 연동 설치에서는 업로드 화면이 마지막이고, 그 업로드가 세 가지를 겸한다:
 *   1) POI 확정   — 삭제 예정 POI 실제 삭제 + editStatus 정리 (관제 batch 응답 처리)
 *   2) 맵 승격    — '<난수>_working' 디렉터리에서 접미사 제거 + 레코드 status active
 *   3) 설치 완료  — robotSetup.status = 'completed'
 * 단독 설치에는 업로드가 없으므로 이 화면이 같은 일을 로컬에서 수행한다. 하나라도 빠뜨리면
 * 지운 POI 가 DB 에 남거나(1), 맵이 작업본으로 남아 다음 스캔 때 덮어쓰기 대상이 되거나(2),
 * 초기 설정 메뉴가 계속 보인다(3).
 *
 * 순서는 확정 → 승격 → 사용 맵 지정 → 완료 기록이다. 완료를 먼저 기록하면 '완료 표시만 되고
 * 데이터는 반영되지 않은' 상태가 남는다.
 */

/** 사이트에 '사용 맵(active)' 은 하나다 — 여러 장을 만든 경우 어느 것을 쓸지 여기서 고른다. */
const Finish = () => {
  const { t } = useTranslation('setup')
  const [maps, setMaps] = useState([])
  const [poiCounts, setPoiCounts] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await mapApi.list({ limit: 200 })
      const rows = visibleMaps(res?.data)
      setMaps(rows)
      // 이미 사용 맵이 있으면 그것을, 없으면 첫 맵을 기본 선택으로 둔다.
      setSelectedId((prev) => prev ?? (rows.find((map) => map.status === 'active') ?? rows[0])?.id ?? null)

      const counts = await Promise.all(
        rows.map(async (map) => {
          try {
            const poiRes = await poiApi.list({ mapId: map.id, limit: 1 })
            return [map.id, poiRes?.total ?? 0]
          } catch {
            // POI 수는 참고 표시라 실패해도 화면을 막지 않는다.
            return [map.id, null]
          }
        })
      )
      setPoiCounts(Object.fromEntries(counts))
    } catch (e) {
      setErr(t('finish.loadFailed', { message: e.message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const handleComplete = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      // 1) POI 로컬 확정 — 맵마다 따로 확정한다(POI 소속이 맵이다).
      for (const map of maps) {
        await poiApi.commitLocal(map.id)
      }

      // 2) 작업본 맵 승격. 이미 확정본인 맵은 건너뛴다.
      //    409(확정본 이름 충돌 · 격자맵 미완료)는 덮어쓰기 여부를 사람이 정해야 하는 상황이라
      //    여기서 임의로 overwrite 하지 않고 중단한다(관제 연동의 교체 확인 모달과 같은 판단).
      for (const map of maps) {
        if (!isWorkingMapDir(resolveMapDir(map))) continue
        try {
          await mapApi.publishMap({ mapId: map.id })
        } catch (error) {
          const code = error?.response?.data?.error?.code
          throw new Error(t('finish.publishFailed', { name: map.name?.default ?? map.id, code: code ?? '' }))
        }
      }

      // 3) 사용 맵 지정 — 승격이 마지막 맵을 active 로 올려 두므로 선택한 맵으로 다시 맞춘다.
      if (selectedId) await mapApi.activateMap(selectedId)

      // 4) 설치 완료 기록.
      await completeSetup()
      setDone(true)
      toast.success(t('finish.completed'), { autoClose: 2500 })
      // 헤더 탭·사이드바·라우트 구성이 완료 여부로 달라지므로 갱신된 상태로 다시 그린다.
      window.location.assign('/map/scan')
    } catch (e) {
      setErr(t('finish.failed', { message: e.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StyledPageContent>
      <Section>
        <PageHero>
          <HeroText>
            <HeroTitle>{t('finish.title')}</HeroTitle>
            <HeroDescription>{t('finish.description')}</HeroDescription>
          </HeroText>
        </PageHero>

        <SetupFormCard>
          <SetupCardIntro>{loading ? t('finish.loading') : t('finish.intro')}</SetupCardIntro>

          {!loading && maps.length === 0 && <InfoText>{t('finish.noMap')}</InfoText>}

          {maps.map((map) => {
            const working = isWorkingMapDir(resolveMapDir(map))
            const count = poiCounts[map.id]
            return (
              <div key={map.id}>
                <RadioLine>
                  <input
                    type="radio"
                    checked={String(selectedId) === String(map.id)}
                    onChange={() => setSelectedId(map.id)}
                  />
                  {map.name?.default ?? `#${map.id}`}
                </RadioLine>
                <SmallNote>
                  {t('finish.mapMeta', {
                    state: working ? t('finish.stateWorking') : t('finish.statePublished'),
                    poi: count == null ? '-' : count
                  })}
                </SmallNote>
              </div>
            )
          })}

          <InfoText>{t('finish.activeHint')}</InfoText>
          {err && <ErrorText>{err}</ErrorText>}

          <WizardButtonWrapSingle>
            <ActionButton type="button" onClick={handleComplete} disabled={busy || loading || done || !maps.length}>
              {busy ? t('common.applying') : t('finish.complete')}
            </ActionButton>
          </WizardButtonWrapSingle>
        </SetupFormCard>
      </Section>
    </StyledPageContent>
  )
}

export default Finish
