import { useState, useEffect } from 'react'
import { Title, TableCard, Button, Section, Modal, Loading } from '@repo/ui'
import { toast } from 'react-toastify'
import { useTranslation } from 'react-i18next'
import {
  StyledUploadPageContent,
  SummaryHeading,
  SummaryList,
  CountList,
  ModalBody,
  ModalNote,
  ProgressBody
} from './styles'

import * as siteApi from '@/apis/siteApis'
import * as buildingApi from '@/apis/buildingApis'
import * as floorApi from '@/apis/floorApis'
import * as areaApi from '@/apis/areaApis'
import * as mapApi from '@/apis/mapApis'
import * as poiApi from '@/apis/mapPoiApis'
import { buildApplyPoiBatchBody } from '@/utils/poiBatch'
import { isWorkingMapDir, publishedNameOf, resolveMapDir, visibleMaps } from '@/utils/mapRecord'
import { useUserStore } from '@repo/stores'

// 다국어 이름 {default, ko-KR, en-US} 에서 표시 문자열을 고른다.
const nameOf = (n) => n?.default ?? n?.['ko-KR'] ?? n?.['en-US'] ?? '-'
// id 로 조회하기 위한 맵.
const indexById = (arr) => Object.fromEntries((arr ?? []).map((x) => [x.id, x]))
// 행에 딸린 맵 이름 표시 — 맵이 없으면 '-'.
const mapNames = (row) => (row.maps ?? []).map((m) => nameOf(m.name)).join(', ') || '-'

/**
 * 시맨틱(POI) 업로드가 가능한 맵 — extMapId 가 있는 맵.
 *
 * extMapId 는 맵 파일 업로드가 성공했을 때 맵 서버가 발행한 id 를 BE 가 레코드에 적어 넣은 값이다
 * (init-setup-be mapUpload.service.uploadMap). POI batch 는 맵 서버가 돌려준 mapId 로 로컬 맵을
 * 찾아 poiVersion 을 갱신하므로(uploadPoiBatch: where extMapId), 맵이 아직 안 올라간 상태에서
 * POI 만 올리면 붙일 맵이 없어 실패한다 → 맵 업로드 전에는 시맨틱 업로드를 막는다.
 */
const uploadedMaps = (row) => (row?.maps ?? []).filter((m) => m?.extMapId)

const UploadTable = () => {
  // transfer 네임스페이스는 업로드/다운로드 두 화면이 공유한다(locales/*/transfer.json).
  const { t } = useTranslation('transfer')
  const [allRows, setAllRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  // 승격(맵 업로드) 후 목록을 다시 읽기 위한 트리거 — 맵 이름/경로가 바뀌므로 화면도 갱신해야 한다.
  const [reloadKey, setReloadKey] = useState(0)

  // 업로드 요약 모달
  const [mapUplaodModalOpen, setMapUplaodModalOpen] = useState(false)
  const [selectMapUploadRow, setSelectMapUploadRow] = useState(false)

  const [poiUploadModalOpen, setPoiUploadModalOpen] = useState(false)
  const [poiUplaodLoading, setPoiUplaodLoading] = useState(false)
  const [slectedPoiRow, setSlectedPoiRow] = useState(null)
  const [poiUploadSummary, setPoiUploadSummary] = useState(null) // { created, edited, deleted }

  // 업로드 진행 모달 — 확인 모달을 닫고 이 모달로 진행 상황을 보여준다(완료/실패 시 null).
  // { title, message } 형태이며, 여러 단계로 진행되는 맵 업로드는 message 만 갈아 끼운다.
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    let alive = true
    const fetchRows = async () => {
      setIsLoading(true)
      try {
        const [sitesRes, buildingsRes, floorsRes, areasRes, mapsRes] = await Promise.all([
          siteApi.list(),
          buildingApi.list(),
          floorApi.list(),
          areaApi.list(),
          mapApi.list()
        ])
        if (!alive) return
        // 활성 사이트가 없으면 어느 사이트의 맵을 보여줄지 정할 수 없다 — 빈 목록으로 끝낸다
        // (로딩 표시는 finally 에서 내려간다).
        const activeStie = sitesRes?.data?.find((e) => e.isActive)
        if (!activeStie) return
        const sites = indexById([activeStie])
        const buildings = indexById(buildingsRes?.data.filter((e) => e.siteId === activeStie?.id))

        let floorsResList = []
        for (const buildingId of Object.keys(buildings)) {
          const matchRes = floorsRes?.data.filter((el) => el.buildingId === Number(buildingId))
          floorsResList = floorsResList.concat(matchRes)
        }
        const floors = indexById(floorsResList)

        let areaResList = []
        for (const floorId of Object.keys(floors)) {
          const matchRes = areasRes?.data.filter((e) => e.floorId === Number(floorId))
          areaResList = areaResList.concat(matchRes)
        }
        const areas = indexById(areaResList)
        // archived(업로드로 대체된 이전 맵)는 업로드 대상이 아니므로 목록에서 뺀다.
        const maps = visibleMaps(mapsRes?.data)

        const mapsByArea = maps.reduce((acc, map) => {
          if (map.areaId == null) return acc
          ;(acc[map.areaId] ??= []).push(map)
          return acc
        }, {})

        const areaRows = Object.keys(areas).map((areaId) => {
          const area = areas[areaId]
          const floor = floors[area.floorId]
          const building = floor && buildings[floor.buildingId]
          const site = building && sites[building.siteId]

          return {
            id: `area-${area.id}`,
            siteId: site?.id,
            site: site ? nameOf(site.siteName) : '-',
            siteExtId: site?.extId,
            buildingId: floor?.buildingId,
            building: building ? nameOf(building.name) : '-',
            buildingExtId: building?.extId,
            buildingName: building?.name.default,
            floorId: area?.floorId,
            floor: floor ? nameOf(floor?.name) : '-',
            floorExitId: floor?.extId,
            floorName: floor?.name?.default,
            areaId: area?.id,
            area: nameOf(area?.name),
            areaExitId: area?.extId,
            areaName: area?.name?.default,
            maps: mapsByArea[area?.id] ?? []
          }
        })

        // 구역에 매이지 않은 맵 — areaId 가 없거나(위치 계층 없이 저장) 가리키는 구역이 사라진 경우.
        // 이 맵들은 구역 행이 없어 지금까지 화면에서 아예 보이지 않았다.
        const orphanRows = []
        // const orphanRows = maps
        //   .filter((map) => map.areaId == null || !areas[map.areaId])
        //   .map((map) => {
        //     const site = map.siteId != null ? sites[map.siteId] : null
        //     return {
        //       id: `map-${map.id}`,
        //       site: site ? nameOf(site.siteName) : '-',
        //       buildingId: undefined,
        //       building: '-',
        //       floorId: undefined,
        //       floor: '-',
        //       areaId: null,
        //       area: '-',
        //       maps: [map]
        //     }
        //   })
        // console.log(orphanRows)

        setAllRows([...areaRows, ...orphanRows])
      } catch (error) {
        console.error('[Upload] 위치/맵 정보 조회 실패:', error)
        if (alive) {
          setAllRows([])
          toast.error('위치·맵 정보를 불러오지 못했습니다.', { autoClose: 3000 })
        }
      } finally {
        if (alive) setIsLoading(false)
      }
    }
    fetchRows()
    return () => {
      alive = false
    }
  }, [reloadKey])

  // 맵 업로드(작업본 → 확정본 승격) 상태. conflict 는 확정본이 이미 있어 교체 확인이 필요한 경우다.
  const [publishing, setPublishing] = useState(false)
  const [conflict, setConflict] = useState(null) // { row, mapId, publishedName }

  /**
   * 작업본 맵을 확정본으로 승격한다 (POST /robot-hub/save-map/publish).
   *
   * 경로는 넘기지 않는다 — 맵 레코드 id 만 주고 BE 가 그 레코드의 경로에서 작업본 디렉터리를
   * 판단한다(init-setup-be map.service.getDirById). 화면은 승격 여부 판정에만 경로를 쓴다.
   *
   * 승격 후 로봇의 정위 맵 경로는 여기서 바꾸지 않는다 — 초기 위치 없이 switch-mode 를 다시 부르면
   * GKR 360° 재정위가 돌아 현재 추정 위치를 잃는다. 정위 전환은 맵 화면에서 사용자가 한다.
   */
  const publishMapDir = async ({ mapId, fallbackName, overwrite = false }) => {
    setPublishing(true)
    try {
      const res = await mapApi.publishMap({ mapId, overwrite })
      const published = res?.data
      toast.success(t('upload.map.done', { name: published?.name ?? fallbackName }), { autoClose: 3000 })
      setConflict(null)
      // 레코드의 경로/이름이 확정본으로 바뀌었다 — 목록을 다시 읽어야 '이미 업로드됨' 판정이 맞는다.
      setReloadKey((key) => key + 1)
      return true
    } catch (error) {
      const status = error?.response?.status
      const body = error?.response?.data
      // 에러 봉투는 { success:false, error:{ message, code? } } 다 — code 로 409 두 종류를 가른다.
      const detail = body?.error?.message ?? body?.message
      const code = body?.error?.code
      if (status === 409 && code === 'GRID_MAP_NOT_READY') {
        // 격자맵(grid_map.yaml/.png)이 아직 안 떨어진 경우 — 교체 확인으로 이어질 문제가 아니다.
        toast.error(t('upload.map.notReady'), { autoClose: 4000 })
      } else if (status === 409 && !overwrite) {
        return 'conflict'
      } else if (status === 409) {
        toast.error(t('upload.map.failed', { message: detail ?? t('upload.map.conflictFallback') }), {
          autoClose: 4000
        })
      } else if (status === 404) {
        // 맵 레코드가 없거나(id 가 지워짐) 레코드가 가리키는 작업본 폴더가 없는 경우.
        toast.error(t('upload.map.notFound'), { autoClose: 4000 })
      } else if (status === 422) {
        // 맵 루트가 읽기 전용이거나, 레코드에 쓸 수 있는 파일 경로가 없는 경우.
        toast.error(t('upload.map.folderUnavailable', { message: detail ?? t('upload.map.mountHint') }), {
          autoClose: 4000
        })
      } else {
        console.error('[Upload] 맵 승격 실패:', error)
        toast.error(t('upload.map.failed', { message: detail ?? error.message }), { autoClose: 4000 })
      }
      return false
    } finally {
      setPublishing(false)
    }
  }

  const handleMapUpload = async (row) => {
    setSelectMapUploadRow(row)
    setMapUplaodModalOpen(true)
  }

  // 맵 업로드 버튼 → 행에 붙은 맵 레코드에서 업로드/승격할 맵을 골라 그 **id** 만 BE 로 넘긴다.
  //
  // 대상 맵은 행이 들고 있는 레코드에서만 고른다 — areaId 로 다시 조회하면 구역 없는 행
  // (areaId=null)에서 쿼리에 areaId 가 빠져 전체 맵이 내려오고, 엉뚱한 맵을 올리게 된다.
  //
  // 경로는 BE 가 레코드에서 판단하므로 요청에 담지 않는다. 화면에서 경로를 보는 것은 판정용뿐이다
  // — 아직 작업본인지(isWorkingMapDir), 승격되면 어떤 이름이 되는지(publishedNameOf).
  const handleConfirmMapUpload = async () => {
    const candidates = (selectMapUploadRow?.maps ?? [])
      .map((map) => ({ map, dir: resolveMapDir(map) }))
      .filter(({ dir }) => Boolean(dir))

    if (!candidates.length) {
      toast.warn(t('upload.map.noMap'), { autoClose: 3000 })
      return
    }
    const working = candidates.filter(({ dir }) => isWorkingMapDir(dir))
    // 작업본이 여러 개면 어느 것을 확정할지 판단할 근거가 없다 — 임의로 고르지 않는다.
    // 같은 디렉터리를 가리키는 레코드가 여럿일 수 있으므로 디렉터리 단위로 센다.
    const workingDirs = Array.from(new Set(working.map(({ dir }) => dir)))
    if (workingDirs.length > 1) {
      toast.error(t('upload.map.multipleWorking', { count: workingDirs.length }), { autoClose: 5000 })
      return
    }

    // 작업본이 없으면 이미 확정본인 맵이다. 관제에 올린 적이 없으면(extMapId 없음) 그대로 올린다 —
    // 단독 설치로 만든 맵은 설치 완료 단계에서 이 로봇 안에서 승격되므로(pages/Finish) 관제 연동으로
    // 전환한 뒤에는 작업본이 남아 있지 않다. 승격은 이미 끝났으니 파일만 올리면 된다.
    const published = candidates.filter(({ map }) => !map.extMapId)
    if (!working.length && published.length !== 1) {
      toast.info(t('upload.map.alreadyUploaded'), { autoClose: 3000 })
      return
    }

    const { map: targetMap, dir: workingDir } = working.length ? working[0] : published[0]
    const session = useUserStore.getState().session
    const row = selectMapUploadRow

    // 확인 모달을 닫고 진행 모달로 넘긴다 — 이후 단계는 모두 진행 모달 아래에서 돈다.
    setMapUplaodModalOpen(false)
    setProgress({ title: t('upload.map.title'), message: t('common.checkingSite') })
    try {
      const siteScopoeRes = await siteApi.retrieveSiteScope({
        siteId: row.siteExtId,
        authorization: session?.accessToken
      })
      if (!siteScopoeRes.success) {
        toast.error(t('common.siteLookupFailed'), { autoClose: 3000 })
        return
      }

      setProgress({ title: t('upload.map.title'), message: t('upload.map.uploading') })
      try {
        await mapApi.uploadMap({
          groupId: siteScopoeRes?.data.groupId,
          siteId: row.siteExtId,
          buildingId: row.buildingExtId,
          floorId: row.floorExitId,
          areaId: row.areaExitId,
          mapType: 'navi',
          filename: 'navi_map.zip',
          authorization: session?.accessToken,
          // zip 대상 경로는 BE 가 이 레코드에서 판단한다(sourceDir 을 보내지 않는다).
          localMapId: targetMap.id
        })
      } catch (error) {
        console.error('[Upload] 맵 서버 업로드 실패:', error)
        toast.error(t('upload.map.fileFailed'), { autoClose: 4000 })
        return
      }

      // 파일이 올라갔으면 로컬 작업본을 확정본으로 승격한다(폴더의 '_working' 제거 + active 전환).
      // 이미 확정본인 맵(전환해 온 단독 설치 맵)은 승격할 것이 없다 — 업로드로 끝이고, 목록만
      // 다시 읽어 extMapId 가 붙은 상태를 반영한다.
      if (!isWorkingMapDir(workingDir)) {
        toast.success(t('upload.map.done', { name: targetMap.name?.default ?? workingDir }), { autoClose: 3000 })
        setReloadKey((key) => key + 1)
        return
      }

      setProgress({ title: t('upload.map.title'), message: t('upload.map.publishing') })
      const publishedName = publishedNameOf(workingDir)
      const result = await publishMapDir({ mapId: targetMap.id, fallbackName: publishedName })
      if (result === 'conflict') {
        setConflict({ row, mapId: targetMap.id, publishedName })
      }
    } catch (error) {
      // 사이트 정보 조회처럼 위에서 개별 처리하지 않은 실패 — 진행 모달만 닫히면 원인을 알 수 없다.
      console.error('[Upload] 맵 업로드 실패:', error)
      toast.error(t('upload.map.failed', { message: error.message }), { autoClose: 4000 })
    } finally {
      // 성공/실패/충돌 어느 쪽이든 진행 모달은 닫는다(충돌은 교체 확인 모달로 이어진다).
      setProgress(null)
    }
  }

  // 교체 확인 → 진행 모달로 넘기고 overwrite 로 다시 승격한다.
  const handleReplaceConfirm = async () => {
    const { mapId, publishedName } = conflict
    setConflict(null)
    setProgress({ title: t('upload.replace.progressTitle'), message: t('upload.replace.progress') })
    try {
      await publishMapDir({ mapId, fallbackName: publishedName, overwrite: true })
    } finally {
      setProgress(null)
    }
  }

  // 업로드 버튼 → 대상 Area 의 맵 POI 를 editStatus 로 분류해 요약 모달을 연다.
  const handleSemanticUpload = async (row) => {
    setSlectedPoiRow(row)
    setPoiUploadSummary(null)
    setPoiUploadModalOpen(true)
    setPoiUplaodLoading(true)
    try {
      // 행이 들고 있는 맵만 대상으로 한다(areaId 재조회 금지 — 위 handleMapUpload 주석 참고).
      const maps = row.maps ?? []
      const poiLists = await Promise.all(maps.map((m) => poiApi.list({ mapId: m.id })))
      const pois = poiLists.flatMap((r) => r?.data ?? [])
      const created = pois.filter((p) => p.editStatus?.created && !p.editStatus?.softDelete)
      const edited = pois.filter((p) => p.editStatus?.edited && !p.editStatus?.created && !p.editStatus?.softDelete)
      const deleted = pois.filter((p) => p.editStatus?.softDelete)
      // 수정 diff 및 basePoiVersionId 구성용 — 원본(editStatus 없는 POI)과 맵 버전을 함께 담는다.
      const originalsByPoiId = Object.fromEntries(pois.filter((p) => !p.editStatus).map((p) => [p.poiId, p]))
      // 버전 기준은 맵 서버에 올라간 맵(extMapId 보유)의 poiVersion 이다 — POI batch 는 그 맵에
      // 붙으므로, 아직 안 올라간 맵의 값을 기준으로 보내면 서버의 버전과 어긋난다.
      const basePoiVersionId = (uploadedMaps(row)[0] ?? maps[0])?.poiVersion ?? null
      setPoiUploadSummary({ created, edited, deleted, originalsByPoiId, basePoiVersionId })
    } catch (error) {
      console.error('[Upload] 업로드 대상 조회 실패:', error)
      toast.error(t('upload.semantic.targetFailed'), { autoClose: 3000 })
      setPoiUploadSummary({ created: [], edited: [], deleted: [] })
    } finally {
      setPoiUplaodLoading(false)
    }
  }

  const handleConfirmUpload = async () => {
    if (!poiUploadSummary) return

    const row = slectedPoiRow
    const session = useUserStore.getState().session

    // 확인 모달을 닫고 진행 모달로 넘긴다.
    setPoiUploadModalOpen(false)
    setProgress({ title: t('upload.semantic.title'), message: t('common.checkingSite') })
    try {
      const res = await siteApi.retrieveSiteScope({
        siteId: row.siteExtId,
        authorization: session?.accessToken
      })
      if (!res?.success) {
        toast.error(t('common.siteLookupFailed'), { autoClose: 3000 })
        return
      }

      const body = buildApplyPoiBatchBody(poiUploadSummary)
      body.groupId = res?.data.groupId
      body.siteId = row.siteExtId
      body.buildingId = row.buildingExtId
      body.floorId = row.floorExitId
      body.areaId = row.areaExitId
      // basePoiVersionId 는 buildApplyPoiBatchBody 가 요약(poiUploadSummary)에서 이미 넣는다 —
      // 행에는 poiVersion 이 없어 여기서 덮어쓰면 undefined 로 지워진다.
      body.authorization = session?.accessToken

      setProgress({ title: t('upload.semantic.title'), message: t('upload.semantic.uploading') })
      await mapApi.uploadPoi(body)

      toast.success(t('upload.semantic.done'), { autoClose: 3000 })
      // 업로드된 POI 는 editStatus 가 정리되고 맵의 poiVersion 이 올라간다 — 목록을 다시 읽는다.
      setReloadKey((key) => key + 1)
    } catch (error) {
      console.error('[Upload] 시맨틱 업로드 실패:', error)
      const detail = error?.response?.data?.error?.message ?? error?.response?.data?.message
      toast.error(t('upload.semantic.failed', { message: detail ?? error.message }), { autoClose: 4000 })
    } finally {
      setProgress(null)
    }
  }

  // 올릴 변경분이 하나라도 있어야 업로드가 의미 있다 — 없으면 버튼을 막고 본문에 이유를 적는다.
  const hasPoiChanges = Boolean(
    poiUploadSummary &&
      (poiUploadSummary.created.length > 0 || poiUploadSummary.edited.length > 0 || poiUploadSummary.deleted.length > 0)
  )

  const columns = [
    // { name: t('common.site'), selector: (row) => row.site, sortable: 'true' },
    { name: t('common.building'), selector: (row) => row.building, sortable: 'true' },
    { name: t('common.floor'), selector: (row) => row.floor, sortable: 'true' },
    { name: t('common.area'), selector: (row) => row.area, sortable: 'true' },
    { name: t('common.map'), selector: (row) => mapNames(row), sortable: 'true' },
    {
      name: t('upload.mapColumn'),
      // 맵 레코드가 없는 행은 올릴 대상이 없다 — 눌러도 '등록된 맵이 없습니다' 로 끝나므로 막는다.
      cell: (row) => {
        const hasMap = (row.maps ?? []).length > 0
        return (
          <Button
            size="sm"
            onClick={() => handleMapUpload(row)}
            disabled={!hasMap || publishing || !!progress}
            title={hasMap ? undefined : t('upload.map.noMap')}
          >
            {t('upload.action')}
          </Button>
        )
      }
    },
    {
      name: t('upload.semanticColumn'),
      // 맵이 맵 서버에 올라가 extMapId 를 받은 뒤에만 POI 를 올릴 수 있다(uploadedMaps 주석 참고).
      cell: (row) => {
        const ready = uploadedMaps(row).length > 0
        return (
          <Button
            size="sm"
            onClick={() => handleSemanticUpload(row)}
            disabled={!ready || !!progress}
            title={ready ? undefined : t('upload.semanticBlocked')}
          >
            {t('upload.action')}
          </Button>
        )
      }
    }
  ]

  return (
    <Section>
      <StyledUploadPageContent className="column">
        <Title>{t('upload.title')}</Title>
        <TableCard
          columns={columns}
          data={allRows}
          // 로딩 prop 이름은 isLoading 이다(TableCard/Table) — loading 으로 주면 무시된다.
          isLoading={isLoading}
          noData={t('upload.noData')}
          pagination
          paginationRowsPerPageOptions={[10, 30, 50, 100]}
        />
      </StyledUploadPageContent>

      {/* 맵 교체 확인 — Modal footer 는 renderButtonComponent.props.children.length 로 버튼 폭을
          계산하므로(packages/ui Modal), 실제 버튼만 배열로 넘긴다. */}
      <Modal
        isOpen={!!conflict}
        title={t('upload.replace.title')}
        closeButton
        onClose={() => setConflict(null)}
        size="sm"
        renderButtonComponent={
          <>
            {[
              <Button key="cancel" size="lg" theme="secondary" onClick={() => setConflict(null)} disabled={publishing}>
                {t('common.cancel')}
              </Button>,
              <Button key="replace" size="lg" theme="delete" onClick={handleReplaceConfirm} disabled={publishing}>
                {t('upload.replace.confirm')}
              </Button>
            ]}
          </>
        }
      >
        {conflict && (
          <ModalBody>
            <SummaryHeading>
              {conflict.row.building} / {conflict.row.floor} / {conflict.row.area}
            </SummaryHeading>
            <div>{t('upload.replace.description', { name: conflict.publishedName })}</div>
            <ModalNote>{t('upload.replace.note')}</ModalNote>
          </ModalBody>
        )}
      </Modal>

      {/* 맵 업로드 확인 */}
      <Modal
        isOpen={mapUplaodModalOpen}
        title={t('upload.map.title')}
        closeButton
        onClose={() => setMapUplaodModalOpen(false)}
        size="sm"
        renderButtonComponent={
          <>
            {[
              <Button key="cancel" size="lg" theme="secondary" onClick={() => setMapUplaodModalOpen(false)}>
                {t('common.cancel')}
              </Button>,
              <Button key="upload" size="lg" onClick={handleConfirmMapUpload}>
                {t('upload.map.confirm')}
              </Button>
            ]}
          </>
        }
      >
        {selectMapUploadRow && (
          <ModalBody>
            <div>{t('upload.map.description')}</div>
            <SummaryList>
              {/* <dt>{t('common.site')}</dt> */}
              {/* <dd>{selectMapUploadRow.site}</dd> */}
              <dt>{t('common.building')}</dt>
              <dd>{selectMapUploadRow.building}</dd>
              <dt>{t('common.floor')}</dt>
              <dd>{selectMapUploadRow.floor}</dd>
              <dt>{t('common.area')}</dt>
              <dd>{selectMapUploadRow.area}</dd>
              {/* <dt>{t('common.map')}</dt>
              <dd>{mapNames(selectMapUploadRow)}</dd> */}
            </SummaryList>
            <ModalNote>{t('upload.map.note')}</ModalNote>
          </ModalBody>
        )}
      </Modal>

      {/* 시맨틱(POI) 업로드 확인 */}
      <Modal
        isOpen={poiUploadModalOpen}
        title={t('upload.semantic.title')}
        closeButton
        onClose={() => setPoiUploadModalOpen(false)}
        size="sm"
        renderButtonComponent={
          <>
            {[
              <Button key="cancel" size="lg" theme="secondary" onClick={() => setPoiUploadModalOpen(false)}>
                {t('common.cancel')}
              </Button>,
              <Button key="upload" size="lg" onClick={handleConfirmUpload} disabled={poiUplaodLoading || !hasPoiChanges}>
                {t('upload.semantic.confirm')}
              </Button>
            ]}
          </>
        }
      >
        <ModalBody>
          {slectedPoiRow && (
            <SummaryHeading>
              {slectedPoiRow.building} / {slectedPoiRow.floor} / {slectedPoiRow.area}
            </SummaryHeading>
          )}

          {poiUplaodLoading || !poiUploadSummary ? (
            <ProgressBody>
              <Loading />
              <div className="hint">{t('upload.semantic.checking')}</div>
            </ProgressBody>
          ) : (
            <>
              <CountList>
                {[
                  { key: 'created', items: poiUploadSummary.created },
                  { key: 'edited', items: poiUploadSummary.edited },
                  { key: 'deleted', items: poiUploadSummary.deleted }
                ].map(({ key, items }) => (
                  <li key={key} className={items.length === 0 ? 'zero' : undefined}>
                    <span>{t(`upload.semantic.${key}`)}</span>
                    <span className="count">{t('upload.semantic.count', { count: items.length })}</span>
                  </li>
                ))}
              </CountList>
              {!hasPoiChanges && <ModalNote>{t('upload.semantic.noChanges')}</ModalNote>}
            </>
          )}
        </ModalBody>
      </Modal>

      {/* 업로드 진행 — 버튼 없이 스피너만 두고, 완료/실패 시 호출부가 닫는다. */}
      <Modal isOpen={!!progress} title={progress?.title} size="sm">
        <ProgressBody>
          <Loading size={28} />
          <div className="message">{progress?.message}</div>
          <div className="hint">{t('common.keepOpen')}</div>
        </ProgressBody>
      </Modal>
    </Section>
  )
}

export default UploadTable
