import { useCallback, useState, useEffect } from 'react'
import { Title, TableCard, Button, Section, Modal, Tag } from '@repo/ui'
import { toast } from 'react-toastify'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@repo/stores'
import { StyledUploadPageContent, SummaryHeading, ModalButtons } from './styles'

import * as siteApi from '@/apis/siteApis'
import * as buildingApi from '@/apis/buildingApis'
import * as floorApi from '@/apis/floorApis'
import * as areaApi from '@/apis/areaApis'
import * as mapApi from '@/apis/mapApis'
import * as mapSyncApi from '@/apis/mapSyncApis'
import { useMapSyncRequests, isSettled } from '@/hooks/useMapSyncRequests'

const nameOf = (n) => n?.default ?? n?.['ko-KR'] ?? n?.['en-US'] ?? '-'
const indexById = (arr) => Object.fromEntries((arr ?? []).map((x) => [x.id, x]))

// 요청 상태 → Tag 테마. pending 은 진행 중임이 드러나야 하고 timeout 은 실패와 같이 취급한다.
const STATUS_THEME = { pending: 'tint', completed: 'success', failed: 'error', timeout: 'error' }

const DownloadTable = () => {
  // transfer 네임스페이스는 업로드/다운로드 두 화면이 공유한다(locales/*/transfer.json).
  const { t } = useTranslation('transfer')
  const [allRows, setAllRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState(null)
  // 다운로드 요청을 보내는 중인 구역(POST 왕복 동안 버튼을 막는다). 요청이 접수된 뒤의 진행
  // 상태는 mapSync 훅이 관리한다.
  const [requestingAreaId, setRequestingAreaId] = useState(null)

  // 요청 결과는 WS(/map-sync/ws)로 온다 — 발신 API 와 수신 API 가 분리돼 있어서
  // 화면이 결과를 기다리려면 구독이 필요하다(hooks/useMapSyncRequests 주석 참고).
  const onSettled = useCallback(
    (request) => {
      if (request.status === 'completed') {
        toast.success(t('download.result.completed'), { autoClose: 3000 })
        return
      }
      if (request.status === 'timeout') {
        toast.error(t('download.result.timeout'), { autoClose: 5000 })
        return
      }
      toast.error(t('download.result.failed', { message: request.errorMessage ?? '-' }), { autoClose: 5000 })
    },
    [t]
  )
  const { byAreaId: requestByAreaId, track } = useMapSyncRequests({ type: 'download', onSettled })

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

        const maps = mapsRes?.data ?? []
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
            site: site ? nameOf(site.siteName) : '-',
            buildingId: floor?.buildingId,
            building: building ? nameOf(building.name) : '-',
            floorId: area.floorId,
            floor: floor ? nameOf(floor.name) : '-',
            areaId: area.id,
            area: nameOf(area.name),
            // 다운로드 요청은 위치를 관제 외부 ID(extId)로 보낸다 — 로컬 PK 가 아니다
            // (init-setup-be mapSync.service.requestDownload 가 extId 로 계층을 찾는다).
            siteExtId: site?.extId,
            buildingExtId: building?.extId,
            floorExtId: floor?.extId,
            areaExtId: area.extId,
            maps: mapsByArea[area.id] ?? []
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
        setAllRows([...areaRows, ...orphanRows])
      } catch (error) {
        console.error('[Download] 위치/맵 정보 조회 실패:', error)
        if (alive) {
          setAllRows([])
          toast.error(t('common.loadFailed'), { autoClose: 3000 })
        }
      } finally {
        if (alive) setIsLoading(false)
      }
    }
    fetchRows()
    return () => {
      alive = false
    }
  }, [t])

  const handleMapDownload = async (row) => {
    // 선택한 위치(building/floor/area)와 대상 맵 정보를 모달로 보여준다.
    setSelectedRow(row)
    setDownloadModalOpen(true)
  }

  const closeDownlaodModal = () => setDownloadModalOpen(false)

  /**
   * 다운로드 요청 발신. 응답(202)은 "관제로 요청을 보냈다" 까지만 뜻하고 실제 결과는
   * 나중에 WS 로 온다 — 그래서 여기서는 requestId 를 훅에 넘겨 추적만 시작한다.
   *
   * groupId 는 로컬에 없어 사이트 스코프 조회로 얻는다(업로드 흐름과 같은 방식 —
   * pages/Upload/uploadTable.jsx).
   */
  const handleConfirmDownload = async () => {
    const row = selectedRow
    if (!row) return

    setDownloadModalOpen(false)

    if (!row.siteExtId || !row.buildingExtId || !row.floorExtId || !row.areaExtId) {
      // 관제에 등록되지 않은(extId 가 없는) 위치는 요청 자체를 만들 수 없다.
      toast.error(t('download.missingExtId'), { autoClose: 4000 })
      return
    }

    const session = useUserStore.getState().session
    setRequestingAreaId(row.areaId)
    try {
      const scope = await siteApi.retrieveSiteScope({
        siteId: row.siteExtId,
        authorization: session?.accessToken
      })
      if (!scope?.success) {
        toast.error(t('common.siteLookupFailed'), { autoClose: 3000 })
        return
      }

      const response = await mapSyncApi.requestMapDownload({
        groupId: scope?.data?.groupId,
        siteId: row.siteExtId,
        buildingId: row.buildingExtId,
        floorId: row.floorExtId,
        areaId: row.areaExtId
      })

      const requestId = response?.data?.requestId
      if (!requestId) {
        toast.error(t('download.requestFailed', { message: '-' }), { autoClose: 4000 })
        return
      }
      // 로컬 areaId 는 발신 응답에 없으므로 여기서 넘겨야 상태 컬럼이 이 행에 붙는다.
      track(requestId, { areaId: row.areaId, type: 'download' })
      toast.info(t('download.requested'), { autoClose: 3000 })
    } catch (error) {
      console.error('[Download] 맵 다운로드 요청 실패:', error)
      const detail = error?.response?.data?.error?.message ?? error?.response?.data?.message
      toast.error(t('download.requestFailed', { message: detail ?? error.message }), { autoClose: 4000 })
    } finally {
      setRequestingAreaId(null)
    }
  }

  const columns = [
    // { name: t('common.site'), selector: (row) => row.site, sortable: 'true' },
    { name: t('common.building'), selector: (row) => row.building, sortable: 'true' },
    { name: t('common.floor'), selector: (row) => row.floor, sortable: 'true' },
    { name: t('common.area'), selector: (row) => row.area, sortable: 'true' },
    {
      name: t('download.statusColumn'),
      // 정렬은 상태 문자열 기준으로 둔다(셀은 Tag 라서 selector 가 따로 필요하다).
      selector: (row) => requestByAreaId[row.areaId]?.status ?? '',
      sortable: 'true',
      cell: (row) => {
        const request = requestByAreaId[row.areaId]
        if (!request) return <span>-</span>
        return (
          <Tag theme={STATUS_THEME[request.status] ?? 'light'}>{t(`download.status.${request.status}`)}</Tag>
        )
      }
    },
    {
      name: t('download.column'),
      cell: (row) => {
        // 같은 구역의 요청이 진행 중이면 중복 발신을 막는다 — 관제 응답이 어느 요청의 것인지
        // 위치로 매칭되는 경로가 있어(broadcast) 동시 요청은 상태 추적을 흐린다.
        const request = requestByAreaId[row.areaId]
        const busy = requestingAreaId === row.areaId || (request && !isSettled(request.status))
        return (
          <Button size="sm" disabled={busy} onClick={() => handleMapDownload(row)}>
            {t('download.action')}
          </Button>
        )
      }
    }
  ]

  return (
    <Section>
      <StyledUploadPageContent className="column">
        <Title>{t('download.title')}</Title>
        <TableCard
          columns={columns}
          data={allRows}
          // 로딩 prop 이름은 isLoading 이다(TableCard/Table) — loading 으로 주면 무시된다.
          isLoading={isLoading}
          noData={t('download.noData')}
          pagination
          paginationRowsPerPageOptions={[10, 30, 50, 100]}
        />
      </StyledUploadPageContent>

      <Modal
        isOpen={downloadModalOpen}
        title={t('download.modalTitle')}
        onClose={closeDownlaodModal}
        size="md"
        renderButtonComponent={
          <ModalButtons>
            <Button onClick={handleConfirmDownload}>{t('download.confirm')}</Button>
            {/* Button 은 variant 를 받지 않는다 — 보조 버튼은 theme 로 지정한다. */}
            <Button theme="secondary" onClick={closeDownlaodModal}>
              {t('common.cancel')}
            </Button>
          </ModalButtons>
        }
      >
        {selectedRow && (
          <div style={{ padding: '1rem 0' }}>
            <SummaryHeading>
              {selectedRow.building} / {selectedRow.floor} / {selectedRow.area}
            </SummaryHeading>
            {/* 요청만 보내고 끝나는 비동기 흐름이라, 결과를 기다리는 방식이 화면에 드러나야 한다. */}
            <p>{t('download.description')}</p>
          </div>
        )}
      </Modal>
    </Section>
  )
}

export default DownloadTable
