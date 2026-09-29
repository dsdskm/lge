import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useEmergencyKey } from '@/hooks/useEmergencyKey'
import ConnectionBar from '@/components/ConnectionBar'
import EmergencyKeyBadge from './EmergencyKeyBadge'
import { LocationBar, resolveLocationName, Section, Title } from '@repo/ui'
import MapCanvas from '@/components/MapCanvas'
import StatusPanel from '@/components/StatusPanel'
import { list as listBuildings } from '@/apis/buildingApis'
import { list as listFloors } from '@/apis/floorApis'
import { list as listAreas } from '@/apis/areaApis'
import { STATUS_TOPICS } from '@/constants/topics'
import { resolveMappingMode, resolveStatusLabel } from '@/utils/lioStatus'
import { syncLevelSelection } from '@/utils/location'
import { useLocationStore } from '@/stores/useLocationStore'
import { resolveWsUrl } from '@/utils/wsUrl'
import { StyledMapPageContent, BadgeRow, MapWorkspace, LocationRow, MappingStatusBadge } from './styles'

/**
 * Map
 *
 * 메인 페이지.
 * - wsUrl 계산 (현재 페이지 기준, 화면에서 수정하지 않는다)
 * - useTelemetry 훅으로 데이터 수신 (진입 시 바로 연결한다 — 아래 autoConnectedRef 참고)
 * - 위치 계층(Building/Floor/Area) 목록 조회 및 선택 상태 관리 (LocationBar 는 표현만 담당)
 * - ConnectionBar + MapCanvas + StatusPanel 조합
 *
 * 위치 선택 바는 화면에 상시 노출하지 않는다 — 저장할 때만 필요하므로 ConnectionBar 의 저장
 * 모달(MapSaveLocationModal) 안에서만 보여준다. 목록 조회와 선택 상태는 그대로 이 페이지가 갖는다.
 *
 * 레이아웃은 cms 콘텐츠 페이지와 동일한 구성이다
 * (StyledPageContent > Title / 상태 배지 / Section):
 * ┌────────────────────────────────────────────┐
 * │ Title (페이지 제목)                          │
 * │                             [매핑 상태 배지] │
 * │ ┌─ Section ───────────────┐ ┌─ Section ──┐ │
 * │ │ ConnectionBar (툴바)     │ │ StatusPanel│ │
 * │ │ MapCanvas               │ │ (정보 패널) │ │
 * │ │ (지도 + 라이다 + 로봇)    │ │            │ │
 * │ └─────────────────────────┘ └────────────┘ │
 * └────────────────────────────────────────────┘
 */
/** 맵 이름은 단일 경로 세그먼트여야 한다(BE resolveSavePath 가 하위 경로 표기를 400 으로 거부). */
const sanitizeSegment = (value) =>
  String(value)
    .trim()
    .replace(/[/\\]+/g, '_')

/**
 * 선택된 위치 계층으로 맵 이름을 만든다: [Building명]_[Floor명]_[Area명]
 *
 * 이 이름은 맵 레코드(name.default)에 남아 목록·드롭다운에 보이는 표시용 이름이다 — 저장 폴더
 * 이름과는 별개다(폴더는 난수, utils/mapRecord.newWorkingMapDirName).
 *
 * 건물 정보를 못 받아온 경우(목록이 비어 있음)는 고를 위치가 없으므로 'Default' 로 둔다
 * — 위치 계층 없이 쓰는 로봇도 매핑/저장은 해야 한다.
 * 건물 정보가 있으면 목록을 받아온 계층이 모두 선택돼야 이름이 나오고(Floor/Area 도 내려오면 셋 다),
 * 미선택 상태에서는 빈 문자열을 돌려 저장 모달이 저장 버튼을 막는다.
 */
const resolveMapName = ({ buildings, floors, areas, location, language }) => {
  if (!buildings.length) return 'Default'

  const levels = [
    [buildings, location.buildingId],
    [floors, location.floorId],
    [areas, location.areaId]
  ]

  const parts = []
  for (const [items, selectedId] of levels) {
    if (!items.length) continue
    if (!selectedId) return ''
    const selected = items.find((item) => String(item.id) === String(selectedId))
    parts.push(sanitizeSegment(resolveLocationName(selected, language)))
  }

  const base = parts.filter(Boolean).join('_')
  return base || 'Default'
}

export default function Map() {
  const { t, i18n } = useTranslation('map')
  // WebSocket 주소는 현재 페이지 기준으로 한 번 계산해 그대로 쓴다 — 화면에서 고치지 않으므로
  // 상태로 들고 있을 이유가 없다(툴바에 주소 입력창을 두지 않는다, components/ConnectionBar).
  const wsUrl = useMemo(resolveWsUrl, [])
  const [fps, setFps] = useState(10) // 기본 10 FPS 업데이트 주기
  // 위치 선택은 스토어가 들고 있다 — 맵 스캔/시맨틱이 같은 작업 위치를 공유하고 새로고침에도 유지된다.
  // zustand v5 는 객체를 만들어 돌려주는 셀렉터가 매 렌더 새 참조를 내므로 필드 단위로 구독한다.
  const buildingId = useLocationStore((state) => state.buildingId)
  const floorId = useLocationStore((state) => state.floorId)
  const areaId = useLocationStore((state) => state.areaId)
  const setLocation = useLocationStore((state) => state.setLocation)
  const pruneMissing = useLocationStore((state) => state.pruneMissing)
  const setLevelIfEmpty = useLocationStore((state) => state.setLevelIfEmpty)
  const location = useMemo(() => ({ buildingId, floorId, areaId }), [buildingId, floorId, areaId])
  const levelActions = useMemo(() => ({ pruneMissing, setLevelIfEmpty }), [pruneMissing, setLevelIfEmpty])

  const [buildings, setBuildings] = useState([])
  const [floors, setFloors] = useState([])
  const [areas, setAreas] = useState([])

  // 위치 계층 목록 조회. 상위 선택이 바뀌면 하위 목록을 다시 받아온다
  // (하위 선택 초기화는 LocationBar 의 onChange 가 넘겨주는 값으로 처리된다).
  //
  // 스토어에 남아 있던 선택을 목록과 맞춘 뒤(없어진 id 는 비움), 비어 있으면 첫 항목으로 채운다
  // (utils/location.js syncLevelSelection) — 셋 다 선택돼야 매핑을 시작할 수 있고(맵 이름이 곧 위치),
  // 상위가 정해지면 하위 조회가 이어지므로 Building → Floor → Area 가 차례로 채워진다.
  useEffect(() => {
    let alive = true
    listBuildings()
      .then((res) => {
        if (!alive) return
        const items = res?.data || []
        setBuildings(items)
        syncLevelSelection(levelActions, 'buildingId', items)
      })
      .catch(() => alive && setBuildings([]))
    return () => {
      alive = false
    }
  }, [levelActions])

  useEffect(() => {
    if (!buildingId) {
      setFloors([])
      return
    }
    let alive = true
    listFloors({ buildingId })
      .then((res) => {
        if (!alive) return
        const items = res?.data || []
        setFloors(items)
        syncLevelSelection(levelActions, 'floorId', items)
      })
      .catch(() => alive && setFloors([]))
    return () => {
      alive = false
    }
  }, [buildingId, levelActions])

  useEffect(() => {
    if (!floorId) {
      setAreas([])
      return
    }
    let alive = true
    listAreas({ floorId })
      .then((res) => {
        if (!alive) return
        const items = res?.data || []
        setAreas(items)
        syncLevelSelection(levelActions, 'areaId', items)
      })
      .catch(() => alive && setAreas([]))
    return () => {
      alive = false
    }
  }, [floorId, levelActions])

  // 저장 후 만들 맵 레코드의 소속. siteId 는 별도 조회 없이 선택된 건물 레코드에서 가져온다
  // (Building.siteId — BE building 모델의 FK).
  const selectedBuilding = useMemo(
    () => buildings.find((item) => String(item.id) === String(buildingId)) ?? null,
    [buildings, buildingId]
  )
  const mapOwner = useMemo(() => ({ siteId: selectedBuilding?.siteId, areaId }), [selectedBuilding, areaId])

  const mapName = useMemo(
    () => resolveMapName({ buildings, floors, areas, location, language: i18n.language }),
    [buildings, floors, areas, location, i18n.language]
  )

  // 저장 모달에 넣을 위치 선택 UI. 선택은 스토어에 남으므로 저장 후에도 그대로 유지된다.
  const locationSelector = (
    <LocationBar buildings={buildings} floors={floors} areas={areas} value={location} onChange={setLocation} />
  )

  const {
    status,
    mapData,
    odomData,
    scanData,
    robotPose,
    frameCorrections,
    topics,
    subscribedTopics,
    customTopicsData,
    customTopicsUpdatedAt,
    toggleSubscribe,
    subscribeTopics,
    unsubscribeTopics,
    connect,
    disconnect
  } = useTelemetry(wsUrl, fps)

  // 화면에 들어오면 바로 연결한다 — 조작 전에 확인해야 하는 값(비상정지 버튼 상태, 매핑 상태)이
  // 모두 텔레메트리로 오므로, 시작 버튼을 누를 때까지 기다리면 그때까지 아무 것도 알 수 없다.
  // 연결만 하고 아무 명령도 보내지 않으므로 로봇이 움직이지는 않는다(시맨틱 화면과 같은 방식).
  //
  // 진입 시 한 번만 건다 — 이후 연결/해제는 툴바 버튼이 맡는다.
  const autoConnectedRef = useRef(false)
  useEffect(() => {
    if (autoConnectedRef.current) return
    autoConnectedRef.current = true
    connect()
  }, [connect])

  // 화면을 떠날 때 정리. disconnect 는 고정 참조라 이 정리는 언마운트에서만 돈다.
  useEffect(() => () => disconnect(), [disconnect])

  // 매핑 진행 상태는 폴링이 아니라 /lio_node/status 구독으로 들어온다.
  // 상태 토픽 이름은 로봇 구성에 따라 달라서 구독 목록에서 실제로 잡힌 것을 쓴다.
  const statusTopic = STATUS_TOPICS.find((topic) => subscribedTopics.includes(topic)) ?? null
  const mappingStatus = statusTopic ? customTopicsData[statusTopic]?.data : null
  // 세분된 status 값은 배지에 그대로 보여주고, 조작부(ConnectionBar)에는 모드로 접어 넘긴다.
  const mappingMode = resolveMappingMode(mappingStatus)
  const isMapping = mappingMode === 'mapping' || mappingMode === 'saving'

  // 비상정지 버튼(하드웨어 키) 상태 — /emergency_key_status.
  // 눌려 있으면 로봇이 움직일 수 없으므로 매핑 시작을 걸어봐야 스캔이 진행되지 않는다.
  // 배지로 상태를 보여주고, 시작 버튼은 ConnectionBar 가 이 값으로 막는다.
  const emergency = useEmergencyKey(subscribedTopics, customTopicsData, customTopicsUpdatedAt)

  // 주행 상태는 이 화면에서 보여주지 않는다 — 맵 스캔은 매핑 세션이라 이동 명령을 걸 수 없고
  // (map 프레임 기준 목표를 잡을 수 없다), 주행은 시맨틱 화면의 일이다.

  return (
    <StyledMapPageContent className="column">
      <Title>{t('pageTitle')}</Title>

      <LocationRow>
        {/* 위치 계층 선택(Building > Floor > Area)은 여기 두지 않는다 — 저장 모달에서만 보여준다. */}

        {/* 상태 배지 묶음 — LocationRow 가 space-between 이라 배지를 감싸야 오른쪽에 붙는다
            (배지를 그대로 두면 가운데에 떠 보인다). */}
        <BadgeRow>
          {/* 비상정지 버튼 상태 (/emergency_key_status) — 눌려 있으면 스캔을 시작해도 로봇이 못 움직인다 */}
          <EmergencyKeyBadge emergency={emergency} t={t} />

          {/* 매핑 진행 상태 (/lio_node/status) */}
          <MappingStatusBadge $active={isMapping}>
            <span className="label typographyBody5">{t('status')}</span>
            <strong className="value typographyBody5">{resolveStatusLabel(mappingStatus, t)}</strong>
          </MappingStatusBadge>
        </BadgeRow>
      </LocationRow>

      <MapWorkspace>
        {/* 지도 Section — 연결·매핑 툴바 + 지도/라이다 캔버스 */}
        <Section gap="1.2rem">
          <ConnectionBar
            status={status}
            onConnect={connect}
            fps={fps}
            onFpsChange={setFps}
            mapName={mapName}
            locationSelector={locationSelector}
            mode={mappingMode}
            emergencyLocked={emergency.isLocked}
            mapOwner={mapOwner}
            mapInfo={mapData?.info ?? null}
            t={t}
          />

          <MapCanvas
            mapData={mapData}
            scanData={scanData}
            odomData={odomData}
            robotPose={robotPose}
            subscribedTopics={subscribedTopics}
            customTopicsData={customTopicsData}
            frameCorrections={frameCorrections}
            t={t}
          />
        </Section>

        {/* 정보 패널 — 토픽 정보 / 토픽 목록 / 범례를 각각 Section 으로 쌓는다 */}
        {/* <StatusPanel
          status={status}
          wsUrl={wsUrl}
          mapData={mapData}
          odomData={odomData}
          scanData={scanData}
          topics={topics}
          subscribedTopics={subscribedTopics}
          customTopicsData={customTopicsData}
          toggleSubscribe={toggleSubscribe}
          subscribeTopics={subscribeTopics}
          unsubscribeTopics={unsubscribeTopics}
          t={t}
        /> */}
      </MapWorkspace>
    </StyledMapPageContent>
  )
}
