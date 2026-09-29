import { useEffect, useRef, useState } from 'react'
import { Button } from '@repo/ui'
import {
  startMapping,
  createMapping,
  resetMapping,
  waitForGridMap,
  discardMapDir,
  create as createMapRecord,
  update as updateMapRecord,
  list as listMapRecords
} from '@/apis/mapApis'
import { list as listPois, remove as removePoi } from '@/apis/mapPoiApis'
import { SETUP_STEP_KEYS, tryAdvanceSetupProgress } from '@/utils/setupProgress'
import {
  buildMapRecordBody,
  isWorkingMapDir,
  newWorkingMapDirName,
  resolveMapDir,
  visibleMaps
} from '@/utils/mapRecord'
import { toast } from 'react-toastify'
import MapSaveCompleteModal from '@/components/MapSaveCompleteModal'
import MapSaveLocationModal from '@/components/MapSaveLocationModal'
import MapOverwriteModal from '@/components/MapOverwriteModal'
import { FpsControl, FpsSlider, MappingActions, Toolbar } from './styles'

/** 새 작업본에 저장할 때의 대상 — 난수 폴더 + 새 레코드(재사용할 레코드가 없다). */
const NEW_SAVE_TARGET = () => ({ dirName: newWorkingMapDirName(), recordId: null })

/**
 * ConnectionBar
 *
 * 매핑 툴바 — 시작/저장/재시작 조작.
 *
 * 연결 자체는 페이지가 진입 시 이미 해 둔다(pages/Map) — 비상정지 버튼 상태처럼 조작 전에 확인해야
 * 하는 값이 텔레메트리로 오기 때문이다. 그래도 시작 버튼은 연결을 겸한다: 진입 시 연결이 실패한
 * 경우를 위한 폴백이다.
 *
 * WebSocket 주소는 화면에 노출하지 않는다 — 현재 페이지 기준으로 계산되므로(utils/wsUrl) 사용자가
 * 고칠 값이 아니다. 연결 해제 버튼은 두지 않는다 — 사용자가 매핑 중에 일부러 끊을 이유가 없다.
 * 연결 조작 버튼도 매핑을 시작하기 전에는 두지 않는다(시작이 연결을 겸한다). 세션이 열린 뒤에도
 * 연결이 끊겨 있을 때만(초기 연결 실패 등) 다시 붙일 연결 버튼이 보인다.
 *
 * 맵 이름은 여기서 입력받지 않는다 — 위치 계층(Building/Floor/Area)에서 만든 mapName(표시용)과
 * 시작 가능 여부(canStartMapping)를 부모(pages/Map)에서 props 로 받는다. 저장 폴더 이름은 난수라
 * 사용자 입력·선택과 무관하다.
 *
 * 위치 선택은 저장 시점에만 한다 — 저장 버튼은 곧바로 save-map 을 호출하지 않고, 부모가
 * locationSelector 로 넘긴 Building/Floor/Area 드롭다운을 담은 모달을 먼저 띄운다.
 *
 * 매핑 조작부의 구성은 로봇 모드가 아니라 사용자의 액션으로 결정한다 — 진입 시에는 로봇이 이미
 * 매핑 중이더라도 시작 버튼만 보여주고, 시작을 누른 뒤에 저장·재시작을 노출한다. 로봇 모드로
 * 판단하면 화면에 들어오는 것만으로 재시작 버튼이 떠서 처음 스캔하는 사용자가 헷갈린다.
 * 로봇 모드(mode)는 여전히 받지만 저장 중 중복 호출을 막는 데만 쓴다.
 *
 * @param {string} [mapName] 맵 레코드에 남길 표시용 이름 ([Building]_[Floor]_[Area], 선택 미완료면 '').
 *   저장 폴더 이름은 이 값이 아니라 난수로 만든다(utils/mapRecord.newWorkingMapDirName).
 * @param {React.ReactNode} [locationSelector] 저장 모달에 넣을 위치 계층 선택 UI
 * @param {boolean} [canStartMapping] 위치 선택이 끝나 매핑을 시작할 수 있는지
 * @param {'mapping'|'saving'|'localization'|'failed'|'unknown'} [mode] 로봇 SLAM 모드
 * @param {boolean} [emergencyLocked] 비상정지 버튼이 눌려 있는지(/emergency_key_status).
 *   눌린 동안에는 스캔 시작을 보내지 않는다 — 로봇이 못 움직이므로 매핑 세션만 열리고 지도는 안 그려진다.
 * @param {{siteId?: number|string, areaId?: number|string}} [mapOwner] 저장 후 만들 맵 레코드의 소속
 * @param {object|null} [mapInfo] 살아 있는 OccupancyGrid 의 info — yaml 을 못 읽을 때의 폴백
 */
export default function ConnectionBar({
  status,
  onConnect,
  fps,
  onFpsChange,
  mapName = '',
  locationSelector = null,
  canStartMapping = true,
  mode = 'unknown',
  emergencyLocked = false,
  mapOwner = {},
  mapInfo = null,
  t
}) {
  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'

  // 이 화면의 매핑 세션은 '사용자가 이 화면에서 시작을 눌렀는지'로만 판단한다 — 로봇 상태(mode)로
  // 판단하지 않는다. 진입 시 로봇이 이미 매핑 중이면(이전 세션이 안 끝났거나 다른 경로로 시작됐거나)
  // 화면에 들어오자마자 저장·재시작만 보여서, 처음 스캔하려는 사용자가 무엇을 눌러야 하는지 알기
  // 어려웠다. 그래서 진입 시에는 항상 시작 버튼만 두고, 시작을 누른 뒤에 저장·재시작을 노출한다.
  // (로봇이 이미 매핑 중이어도 시작은 switch_mode mode=mapping 이라 새 세션으로 다시 시작된다.)
  const [sessionStarted, setSessionStarted] = useState(false)
  // 명령 왕복 중 중복 클릭 방지 — 세션 상태가 아니라 요청 진행 여부다.
  const [isBusy, setIsBusy] = useState(false)
  const inMappingSession = sessionStarted
  // 저장 완료 모달 상태. savedMap 이 있으면 모달이 열린다.
  const [savedMap, setSavedMap] = useState(null)
  // 저장 위치(Building/Floor/Area) 선택 모달 — 저장 버튼은 이 모달만 열고, 실제 저장은 모달에서 한다.
  const [isSaveLocationOpen, setSaveLocationOpen] = useState(false)
  // 덮어쓰기 확인 대기 중인 저장 대상 — 작업 중인 맵이 있을 때만 채워진다(있으면 확인 모달이 열린다).
  const [pendingOverwrite, setPendingOverwrite] = useState(null)
  // 2D 격자맵 산출물 확인 상태. 'checking' 은 저장 직후 폴링 중이라는 뜻이고 저장 버튼을 잠그므로
  // (아래 MappingActions), 저장 전 초기값은 'unknown' 이어야 한다 — 'checking' 으로 두면 화면에
  // 들어오는 것만으로 첫 저장이 막힌다. 저장 시점에 saveMapTo 가 'checking' 으로 바꾼다.
  const [gridMapState, setGridMapState] = useState('unknown')
  // grid_map 폴링이 끝나기 전에 화면을 떠날 수 있으므로 언마운트 후 setState 를 막는다.
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    []
  )

  // 위치 계층을 받아온 경우에는 Building/Floor/Area 가 모두 선택돼야 매핑을 시작할 수 있다
  // (맵 이름이 곧 위치라서, 미선택 상태로 시작하면 어디를 그린 맵인지 남지 않는다).

  // init-setup-be → robot-hub gRPC 경유라 로봇이 거부하면 4xx/5xx 로 돌아온다.
  // 버튼 구성은 로봇 모드에서 오므로 여기서는 요청 진행 여부(isBusy)만 관리한다.
  const runMappingAction = async (action, { onSuccess, onError, successMessage } = {}) => {
    setIsBusy(true)
    try {
      const response = await action()
      onSuccess?.(response)
      toast.success(response?.data?.message || successMessage, { autoClose: 1500 })
    } catch (error) {
      onError?.()
      // init-setup-be 에러 응답 봉투: { success: false, error: { message } }
      const message = error?.response?.data?.error?.message || error?.message || 'Request failed'
      toast.error(message, { autoClose: 3000 })
    } finally {
      setIsBusy(false)
    }
  }

  const handleStart = async () => {
    // 비상정지 버튼이 눌려 있으면 시작 요청 자체를 보내지 않는다 — 로봇이 못 움직이는 상태로
    // 매핑 세션만 열리면 지도가 그려지지 않는데 화면은 '매핑 중' 이 되어 원인을 알기 어렵다.
    // 버튼을 비활성으로 두는 대신 눌렀을 때 이유를 알려 준다(비활성 버튼은 이유를 말하지 못한다).
    if (emergencyLocked) {
      toast.error(t('emergencyKeyBlockedMapping'), { autoClose: 4000 })
      return
    }
    // 진입 시 연결이 실패했거나 사용자가 해제한 상태일 수 있으므로 시작이 연결을 겸한다 —
    // 세션 전에는 연결 버튼을 노출하지 않아 여기 말고는 다시 붙일 자리가 없다.
    // 연결은 부모(useTelemetry)의 상태 전이라 기다릴 대상이 없어 매핑 시작 요청과 나란히 진행된다.
    if (!isConnected && !isConnecting) onConnect()
    await runMappingAction(startMapping, {
      onSuccess: () => {
        setSessionStarted(true)
        // 매핑을 시작했을 뿐이므로 이 단계는 아직 완료되지 않은 것으로 기록한다(작업 중인 단계 = 맵 스캔).
        tryAdvanceSetupProgress(SETUP_STEP_KEYS.MAP_SCAN)
      },
      onError: () => setSessionStarted(false),
      successMessage: 'Mapping started'
    })
  }
  /**
   * 저장할 폴더 이름과, 그 폴더를 이미 가리키고 있는 맵 레코드를 찾는다.
   *
   * 재사용 대상은 '_working' 폴더 + inactive 레코드뿐이다 — 이 구역에 작업본 맵이 있으면 그 폴더(레코드
   * imagePath/yamlPath → 맵 디렉터리)에 다시 저장하고 레코드도 새로 만들지 않고 갱신한다
   * (아래 registerMapRecord). 같은 구역을 다시 스캔할 때마다 새 폴더를 만들면 작업본이 쌓여서
   * 업로드 단계가 어느 것을 승격할지 판단할 수 없고(pages/Upload 는 작업본이 2개 이상이면 승격을
   * 막는다), 폴더만 재사용하고 레코드를 늘리면 같은 폴더를 가리키는 맵이 여러 건 남는다.
   *
   * 접미사가 없는 폴더나 active 레코드는 이미 업로드로 확정된 맵이라 절대 건드리지 않는다 —
   * 서비스에 쓰이는 맵 파일을 덮어쓰게 되고, 레코드도 승격 시점(BE 가 _working 을 떼면서
   * 경로/이름/status 를 갱신하는 그때)에만 바뀌어야 한다. 확정본만 있는 구역은 새 작업본을
   * 난수 폴더로 시작한다.
   *
   * 작업본을 못 찾으면(첫 스캔 · 확정본만 있음 · 구역 미선택 · 조회 실패) 난수로 새 폴더를 만든다
   * — 조회 실패로 저장 자체를 막지는 않는다.
   *
   * @returns {Promise<{dirName: string, recordId: number|string|null, existingName?: string}>}
   *   recordId 는 작업본 폴더를 재사용할 때만 채워진다(확정본이면 항상 null).
   *   existingName: 덮어쓰기 확인 모달에 보여줄, 재사용할 작업본의 표시 이름.
   */
  const resolveSaveTarget = async () => {
    if (!mapOwner.areaId) return NEW_SAVE_TARGET()
    try {
      // 조건은 두 개를 모두 만족해야 한다: 폴더가 '_working' 이고 레코드가 inactive.
      // 둘은 같은 사실의 두 표현이지만(저장 시 inactive 로 등록 → 승격 때 BE 가 active 로 올린다),
      // 어긋났을 때 덮어쓰기가 위험한 쪽으로 판단한다 — '_working' 인데 active 인 레코드는
      // 서비스에 쓰이는 맵일 수 있으므로 재사용하지 않고 새 작업본을 시작한다
      // (그 결과 작업본 폴더가 하나 남더라도 업로드 단계가 경고로 알려 준다).
      // status 는 쿼리로도 넘기고 받은 목록에서도 확인한다(BE 가 필터를 무시해도 안전하도록).
      const response = await listMapRecords({ areaId: mapOwner.areaId, status: 'inactive' })
      const working = visibleMaps(response?.data).find(
        (map) => map?.status === 'inactive' && isWorkingMapDir(resolveMapDir(map))
      )
      // save-map 은 폴더 이름(단일 세그먼트)만 받는다 — 절대 경로에서 마지막 세그먼트만 넘긴다.
      const dirName = working ? resolveMapDir(working).split('/').pop() : ''
      if (dirName) return { dirName, recordId: working.id, existingName: working.name?.default ?? '' }
      return NEW_SAVE_TARGET()
    } catch {
      return NEW_SAVE_TARGET()
    }
  }

  /**
   * 저장 버튼(위치 선택 모달의 '저장') → 저장할 폴더를 정한다.
   * 이미 작업 중인 맵이 있으면 그 폴더를 덮어쓰게 되므로 바로 저장하지 않고 확인 모달을 먼저 띄운다.
   */
  const handleSave = async () => {
    const target = await resolveSaveTarget()
    if (target.recordId) {
      setPendingOverwrite(target)
      return
    }
    await saveMapTo(target)
  }

  /** 덮어쓰기 확인 모달의 '덮어쓰기' — 확인한 폴더로 그대로 저장한다. */
  const handleOverwriteConfirm = async () => {
    const target = pendingOverwrite
    if (!target) return
    setPendingOverwrite(null)
    await saveMapTo(target)
  }

  /**
   * 실제 저장 요청.
   *
   * save-map 바디는 { name } 만 받는다 — save_path 는 LIO_MAP_BASE_DIR 하위 강제라 FE 가 쓸 이유가 없다.
   * 여기서 보내는 name 은 저장 '폴더' 이름이다(작업본 재사용 또는 난수). 사람이 읽을 이름은
   * 맵 레코드(name.default)에 위치 계층으로 만든 mapName 을 넣는다.
   */
  const saveMapTo = async ({ dirName, recordId }) => {
    const displayName = mapName.trim()
    await runMappingAction(() => createMapping({ name: dirName }), {
      onSuccess: (response) => {
        // 저장이 시작됐으므로 위치 선택 모달은 닫는다(실패 시에는 열어둔 채 재시도할 수 있게 한다).
        setSaveLocationOpen(false)
        // 저장해도 lio_node 는 매핑 세션을 유지하지만(status 가 다시 mapping), 이 화면의 한 사이클은
        // 끝났으므로 조작부를 시작 버튼으로 되돌린다.
        setSessionStarted(false)
        // 맵 저장이 끝났으므로 이 단계를 완료로 기록한다 — 다음 작업 단계(시맨틱)를 가리킨다.
        tryAdvanceSetupProgress(SETUP_STEP_KEYS.MAP_SEMANTIC)
        // 저장 응답 성공 = 3D 맵(PCD + trajectory) 저장 완료 → 완료 모달을 띄운다.
        // 폴더 이름은 백엔드가 확정한 값을 쓴다(요청과 같지만 BE 가 정본이다).
        const savedDir = response?.data?.name || dirName
        // 모달에는 사람이 읽을 이름을 보여준다 — 난수 폴더 이름은 사용자가 확인할 값이 아니다.
        setSavedMap({ name: displayName || savedDir })
        // 작업본을 덮어썼으면 그 맵에 달린 POI 는 모두 지운다 — 기준 맵이 바뀌었으니 이전 좌표는
        // 더 이상 이 맵의 좌표가 아니다(레코드를 재사용하므로 POI 가 그대로 딸려 온다).
        if (recordId) clearMapPois(recordId)
        setGridMapState('checking')
        // 2D 격자맵(grid_map.yaml/.png)은 lio_node 가 응답 뒤 비동기로 저장하므로 파일로 확인한다.
        // 확인이 끝나면 그 산출물 메타로 맵 레코드(POST /maps)를 등록한다 — 레코드가 없으면
        // 시맨틱 화면이 이 구역의 맵을 찾지 못한다.
        const savedPath = response?.data?.savePath
        // 산출물 확인은 폴더 이름으로 한다(파일 경로 기준). 레코드에 남길 이름은 표시용이다.
        waitForGridMap(savedDir).then(({ state, artifacts }) => {
          if (!aliveRef.current) return
          setGridMapState(state)
          registerMapRecord({
            savePath: savedPath,
            name: displayName || savedDir,
            artifacts,
            recordId,
            dirName: savedDir,
            gridMapState: state
          })
        })
      },
      successMessage: 'Map saved'
    })
  }
  /**
   * 맵에 달린 POI 를 모두 지운다 — 작업본 폴더를 덮어써서 기준 맵이 새로 그려진 경우에만 호출한다.
   *
   * POI 는 맵(mapId) 좌표계의 지점이므로 맵을 다시 스캔하면 이전 좌표는 의미가 없다. 레코드를
   * 재사용하면(같은 mapId) POI 가 그대로 남아 새 맵 위의 엉뚱한 자리를 가리키게 된다.
   *
   * BE 에 일괄 삭제 라우트가 없어 목록을 받아 한 건씩 지운다(POI 수는 구역당 수십 건 수준).
   * 실패는 저장 흐름을 막지 않고 토스트로만 알린다 — 맵 파일 저장은 이미 끝난 상태다.
   */
  const clearMapPois = async (mapId) => {
    try {
      const response = await listPois({ mapId })
      const pois = response?.data ?? []
      if (pois.length === 0) return
      await Promise.all(pois.map((poi) => removePoi(poi.id)))
      toast.info(t('poiCleared', { count: pois.length }), { autoClose: 3000 })
    } catch (error) {
      const message = error?.response?.data?.error?.message || error?.message || 'Request failed'
      toast.warn(`${t('poiClearFailed')}: ${message}`, { autoClose: 4000 })
    }
  }

  /**
   * 맵 레코드를 만들지 못한 저장 폴더를 지운다(DELETE /robot-hub/save-map).
   *
   * 레코드가 없는 폴더는 어디서도 참조되지 않는 채 맵 루트에 남고, 업로드 단계는 작업본이 둘 이상이면
   * 승격을 막으므로(pages/Upload) 다음 스캔까지 방해한다.
   *
   * 호출 조건은 registerMapRecord 쪽에 있다 — 이번 저장으로 만든 새 폴더이고 격자맵이 다 떨어진
   * (ready) 경우만이다. 이미 있던 작업본을 덮어쓴 경우(recordId)에는 레코드가 살아 있으므로 BE 가
   * 409 로 거부하고, pending/unknown 은 lio_node 가 아직 쓰는 중일 수 있어 건드리지 않는다.
   */
  const discardSavedDir = async (dirName) => {
    if (!dirName) return false
    try {
      const response = await discardMapDir({ name: dirName })
      return response?.data?.removed === true
    } catch (error) {
      const message = error?.response?.data?.error?.message || error?.message || 'Request failed'
      toast.warn(`${t('mapDirDiscardFailed')}: ${message}`, { autoClose: 4000 })
      return false
    }
  }

  /**
   * 저장된 맵을 DB 에 등록한다(POST /maps). 실패해도 파일 저장 자체는 이미 끝난 상태이므로
   * 매핑 흐름을 막지 않고 토스트로만 알린다.
   *
   * @param {string|number|null} [recordId] 재사용한 '작업본(_working)' 폴더의 맵 레코드 id.
   *   있으면 새로 만들지 않고 그 레코드를 갱신한다(PUT /maps/:id) — 같은 폴더에 다시 저장한
   *   경우이므로 레코드도 하나만 있어야 한다(업로드 단계가 작업본 1건을 전제로 한다).
   *   확정본(접미사 없는 폴더 · active 레코드)에는 절대 채워지지 않는다(resolveSaveTarget) —
   *   확정된 맵 레코드는 승격 시점에 BE 만 갱신한다.
   * @param {string} [dirName] 이번에 저장한 폴더 이름 — 등록이 막혔을 때 폐기 대상이다.
   * @param {'ready'|'pending'|'unknown'} [gridMapState] 격자맵 산출물 판정 결과.
   *   폐기는 ready 일 때만 한다(위 discardSavedDir).
   */
  const registerMapRecord = async ({
    savePath,
    name,
    artifacts,
    recordId = null,
    dirName = '',
    gridMapState: gridState = 'unknown'
  }) => {
    const { body, missing } = buildMapRecordBody({
      savePath,
      name,
      siteId: mapOwner.siteId,
      areaId: mapOwner.areaId,
      meta: artifacts?.gridMap?.meta ?? null,
      info: mapInfo,
      gridImageFile: artifacts?.gridMap?.image
    })

    if (!body) {
      // resolution 을 못 구한 경우 — BE 가 400 으로 거부하므로 보내지 않는다.
      // 레코드가 없으면 이 폴더는 참조 없이 남으므로, 이번 저장으로 만든 새 폴더는 되돌린다.
      // 격자맵이 다 떨어진(ready) 경우만 지운다 — pending/unknown 은 lio_node 가 아직 쓰는 중일 수
      // 있고(save_grid_map 은 저장 응답 뒤 비동기), 맵 루트를 못 읽는 환경이면 판정 자체가 불가다.
      const discarded = !recordId && gridState === 'ready' && (await discardSavedDir(dirName))
      const key = discarded ? 'mapRecordSkippedDiscarded' : 'mapRecordSkipped'
      toast.warn(t(key, { fields: missing.join(', ') }), { autoClose: 4000 })
      return
    }
    try {
      if (recordId) await updateMapRecord(recordId, body)
      else await createMapRecord(body)
      if (missing.length > 0) {
        toast.warn(t('mapRecordPartial', { fields: missing.join(', ') }), { autoClose: 4000 })
      }
    } catch (error) {
      const message = error?.response?.data?.error?.message || error?.message || 'Request failed'
      toast.error(`${t('mapRecordFailed')}: ${message}`, { autoClose: 4000 })
    }
  }

  /**
   * 재시작 — 수집 중인 데이터를 버리고 새 매핑 세션을 시작한다(switch_mode mode=mapping).
   *
   * 시작과 같은 호출이므로 같은 전제를 둔다: 비상정지 버튼이 눌려 있으면 보내지 않는다.
   * 보내면 이전 데이터만 사라지고 로봇은 못 움직여 빈 지도로 '매핑 중' 이 되는데, 화면만 보면
   * 원인을 알 수 없다. 버튼은 그대로 열어 두고 눌렀을 때 이유를 알려 준다(handleStart 와 동일).
   */
  const handleReset = async () => {
    if (emergencyLocked) {
      toast.error(t('emergencyKeyBlockedReset'), { autoClose: 4000 })
      return
    }
    await runMappingAction(resetMapping, { successMessage: 'Mapping reset' })
  }

  return (
    <>
      <Toolbar>
        {/* 페이지 제목은 페이지의 Title 이 담당한다 — 툴바는 조작 요소만 갖는다. */}

        {/* 연결/해제 버튼은 두지 않는다 — 연결은 페이지 진입 시 자동으로 붙고(pages/Map), 실패하면
            시작 버튼이 연결까지 겸해서 다시 시도한다(아래 handleStart). WebSocket 주소도 입력창으로
            노출하지 않는다 — 현재 페이지 기준으로 계산되므로(utils/wsUrl.js) 사용자가 고칠 값이 아니다. */}

        {/* 업데이트 주기 (FPS) 조절 슬라이더 — 잠시 감춘다.
            fps 는 그대로 부모의 기본값(10 Hz)으로 동작한다(useTelemetry) — 이 UI 만 빠진다.
            되살릴 때는 label 로 감싸 둔 형태 그대로 쓰면 숫자·글자를 눌러도 슬라이더가 잡힌다. */}
        {/* <FpsControl>
          <span className="label">FPS</span>
          <span className="value">{fps} Hz</span>
          <FpsSlider
            type="range"
            min="1"
            max="30"
            value={fps}
            onChange={(e) => onFpsChange(Number(e.target.value))}
            $percentage={((fps - 1) / 29) * 100}
          />
        </FpsControl> */}

        {/* 매핑 조작부는 항상 자리를 유지한다 — 연결 전에도 시작 버튼은 보여준다(시작이 연결을 겸한다). */}
        <MappingActions>
          {/* 저장될 맵 이름은 여기 노출하지 않는다 — 위치(Building/Floor/Area)를 고르는 저장 모달에서
              확정되므로, 선택 UI 가 없는 이 줄에 미리 보여줄 이름이 없다. */}
          {/* 저장 · 재시작은 매핑 세션(로봇 모드 mapping/saving)에서만 의미가 있으므로 그때만 노출한다
              (세션 전에는 비활성 버튼도 두지 않아 시작 버튼만 남는다). */}
          {inMappingSession ? (
            <>
              {/* 저장 중(mode === 'saving')에는 중복 호출을 막는다 — lio_node 가 블로킹으로 처리한다.
                  저장 위치는 이 버튼으로 열리는 모달에서 고른다.
                  격자맵 확인 중(gridMapState === 'checking')에도 막는다 — 직전 저장의 맵 레코드가 아직
                  등록되지 않은 시점이라 resolveSaveTarget 이 그 작업본 폴더를 못 찾고(레코드로 조회한다)
                  새 난수 폴더를 또 만든다. 그러면 작업본이 2개가 되어 업로드 단계가 승격을 막는다. */}
              <Button
                size="md"
                onClick={() => setSaveLocationOpen(true)}
                disabled={isBusy || mode === 'saving' || gridMapState === 'checking'}
                title={(gridMapState === 'checking' && t('waitGridMapCheck')) || undefined}
              >
                {t('save')}
              </Button>
              <Button size="md" theme="tertiary" onClick={handleReset} disabled={isBusy}>
                {t('reset')}
              </Button>
            </>
          ) : (
            // 시작은 연결을 겸하므로 연결 여부로 막지 않는다 — 남은 전제는 위치 선택뿐이다.
            <Button
              size="md"
              onClick={handleStart}
              disabled={!canStartMapping || isBusy}
              title={(!canStartMapping && t('selectLocationForMapping')) || undefined}
            >
              {t('start')}
            </Button>
          )}
        </MappingActions>
      </Toolbar>

      {/* 저장 위치 선택 — Building/Floor/Area 를 고르고 저장 이름을 확정한다 */}
      <MapSaveLocationModal
        isOpen={isSaveLocationOpen}
        mapName={mapName}
        busy={isBusy || mode === 'saving'}
        onConfirm={handleSave}
        onClose={() => setSaveLocationOpen(false)}
      >
        {locationSelector}
      </MapSaveLocationModal>

      {/* 작업 중인 맵 덮어쓰기 확인 — 같은 구역의 작업본 폴더에 다시 저장할 때만 뜬다.
          취소하면 위치 선택 모달이 그대로 남아 다시 시도할 수 있다. */}
      <MapOverwriteModal
        isOpen={Boolean(pendingOverwrite)}
        mapName={pendingOverwrite?.existingName}
        dirName={pendingOverwrite?.dirName}
        busy={isBusy || mode === 'saving'}
        onConfirm={handleOverwriteConfirm}
        onClose={() => setPendingOverwrite(null)}
      />

      {/* 저장 완료 안내 — 닫기 / 시맨틱 화면 이동 */}
      <MapSaveCompleteModal
        isOpen={Boolean(savedMap)}
        mapName={savedMap?.name}
        gridMapState={gridMapState}
        onClose={() => setSavedMap(null)}
      />
    </>
  )
}
