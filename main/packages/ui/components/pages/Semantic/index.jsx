import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Section, Button, Dropdown, Input, Modal } from '@repo/ui'
import {
  CommandBar,
  CommandButtons,
  CommandRow,
  CommandFilters,
  DetailModalBody,
  MetaText,
  ObstacleFormBody,
  SemanticWorkspace
} from './styles'
import SemanticTable from './SemanticTable'
import SemanticDetail from './SemanticDetail'
import ObstacleTable from './ObstacleTable'
import ObstaclePointList from './ObstaclePoints'

// 편집 대상 종류. POI 는 점(pose), VIRTUAL-OBSTACLE 은 지도에 그린 가상 장애물이다.
const SEMANTIC_TYPE_POI = 'POI'
const SEMANTIC_TYPE_OBSTACLE = 'VIRTUAL-OBSTACLE'
const SEMANTIC_TYPES = [SEMANTIC_TYPE_POI, SEMANTIC_TYPE_OBSTACLE]
const OPERATION_TYPES = ['IN-USE', 'WORKING']

// 가상 장애물의 형태. 점은 클릭 한 번, 선분/사각형은 드래그 한 번, 폴리곤은 점을 하나씩 찍는다.
// 지도 구현(init-setup 의 MapCanvas)도 같은 값을 쓴다.
// 로봇(corepath_nav2_plugins::VirtualObstacleLayer)은 shape 를 모르고 점 개수로만 판정한다 —
// 1점은 반경 0.05 m 점, 2점은 거리 0.05 m 선분, 3점 이상은 폴리곤 내부다. shape 를 함께 두는 것은
// 그린 것을 같은 편집 방식으로 다시 열기 위한 UI 메타다(사각형은 축정렬 리사이즈).
const OBSTACLE_SHAPE_POINT = 'POINT'
const OBSTACLE_SHAPE_LINE = 'LINE'
const OBSTACLE_SHAPE_RECTANGLE = 'RECTANGLE'
const OBSTACLE_SHAPE_POLYGON = 'POLYGON'
const OBSTACLE_SHAPES = [OBSTACLE_SHAPE_POINT, OBSTACLE_SHAPE_LINE, OBSTACLE_SHAPE_RECTANGLE, OBSTACLE_SHAPE_POLYGON]

/**
 * 장애물 타입 — 로봇과 약속된 정수 enum(0~9)이다.
 * 기본값은 설치 화면에서 사람이 지정하는 것만 담았다: 2 Forbidden, 3 VirtualWall, 4 MopForbidden,
 * 5 DoorSill, 6 Object, 9 Carpet. 0(Unknown)/1(DockWall)/7(Stain)/8(NavObs)는 로봇이 런타임에
 * 만들어 넣는 시스템 타입이라 뺀다.
 * 정본은 BE(GET /map-obstacles/meta)다 — 앱이 obstacleTypes 로 그 값을 넘기면 그것을 쓴다.
 */
const OBSTACLE_TYPE_OBJECT = 6
const DEFAULT_OBSTACLE_TYPES = [2, 3, 4, 5, 6, 9]
// 타입 필터의 '전체' 값. 타입은 정수라 문자열 'ALL' 과 겹치지 않는다.
const OBSTACLE_TYPE_FILTER_ALL = 'ALL'

/**
 * obstacleList 의 기본값 — 모듈 상수로 둬야 한다.
 * 기본값을 `[]` 리터럴로 쓰면 렌더마다 새 배열이 되어, 이 값을 deps 로 보는 effect 가
 * 매 렌더 작업본을 다시 만든다(무한 초기화).
 */
const EMPTY_OBSTACLES = []

/**
 * POI / 가상 장애물 편집 화면 본문.
 *
 * 페이지 제목·위치 선택 등 페이지 껍데기는 이 컴포넌트를 쓰는 앱 페이지가 갖는다
 * (init-setup 의 Map/Semantic 은 StyledPageContent > Title / LocationBar / Section 구성).
 * 여기서는 명령 버튼 + (지도 | 목록/상세) 두 열만 렌더한다.
 *
 * @param {React.ReactNode|Function} [mapSlot] 왼쪽 지도 칸에 넣을 내용.
 *   지도 렌더러는 앱마다 달라서(init-setup 은 foxglove 기반 MapCanvas) 주입받는다.
 *   함수로 주면 지금 목록에 보이는 POI 를 넘겨준다 —
 *   ({ pois, obstacles, drawObstacleShape, onObstacleDrawn, selectedObstacleId, editingObstacleId,
 *     onObstacleResize, onObstacleVertexMove }) => ReactNode.
 *   지도에 POI 를 함께 그리려면 이 형태를 쓴다(작업본의 미저장 POI 까지 반영된다).
 *   pois 뒤의 값들은 가상 장애물 편집용이다: obstacles 는 지금 목록에 있는 도형,
 *   drawObstacleShape 는 지금 그리는 중인 형태('POINT'/'LINE'/'RECTANGLE'/'POLYGON'/null),
 *   onObstacleDrawn 은 지도가 도형을 확정했을 때 목록에 넣는 콜백,
 *   selectedObstacleId/editingObstacleId 는 강조·꼭지점 편집 대상,
 *   onObstacleResize(사각형 크기 조절/회전)와 onObstacleVertexMove(그 밖 형태의 점 옮기기)는 지도에서
 *   좌표가 바뀔 때 목록에 반영하는 콜백이다
 *   (지도 구현이 이 값들을 받도록 되어 있어야 가상 장애물 편집이 동작한다).
 * @param {object|null} [robotPose] 로봇 현재 위치 { x, y, yaw(rad) } — 지도와 같은 프레임.
 *   POI 상세의 '현재 위치로 설정' 버튼이 쓴다. 텔레메트리는 앱이 들고 있으므로 주입받는다.
 * @param {string} [noData] POI 가 하나도 없을 때 목록 자리에 보여줄 문구(앱의 i18n 문자열).
 * @param {Function} [onPoiGoto] 목록의 이동 버튼 — (poi) => void. 이동 명령은 앱이 갖고 있으므로
 *   주입받고, 없으면 이동 버튼을 아예 노출하지 않는다(이동을 지원하지 않는 앱).
 * @param {boolean} [gotoDisabled] 이동 버튼을 잠글지 — 이미 주행 중이거나 요청 중일 때 앱이 켠다.
 * @param {string} [gotoLabel] 이동 버튼 문구(앱의 i18n 문자열). 없으면 semantic 번역의 goto 를 쓴다.
 *
 * @param {Array} [obstacleList] 저장된 가상 장애물 목록 — { id, obsId, type, name, shape, points }.
 *   앱이 BE(GET /map-obstacles?mapId=)에서 조회해 넘긴다. 이 값이 바뀌면 작업본을 다시 만든다.
 * @param {number[]} [obstacleTypes] 고를 수 있는 타입 목록(정수 enum). 앱이 BE meta 값을 넘기면
 *   그것을 쓰고, 없으면 DEFAULT_OBSTACLE_TYPES 를 쓴다.
 * @param {Function} [onObstacleSave] 가상 장애물 임시 저장 — (workingObstacles) => Promise|void.
 *   앱이 전체 치환(PUT /map-obstacles/bulk)으로 저장하고 목록을 다시 조회해 obstacleList 로
 *   내려주면 IN-USE 가 갱신된다. 없으면 저장이 화면 안에서만 끝난다(BE 없이 그려보는 경우).
 */
const SemanticPage = ({
  poiVersion,
  poiList,
  onSave,
  onCancel,
  mapSlot,
  robotPose = null,
  noData = '',
  onPoiGoto = null,
  gotoDisabled = false,
  gotoLabel = '',
  obstacleList = EMPTY_OBSTACLES,
  obstacleTypes = DEFAULT_OBSTACLE_TYPES,
  onObstacleSave = null
}) => {
  const { t } = useTranslation('semantic')
  const { t: tCommon } = useTranslation('common')

  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('MODE_LIST')
  const [selectedRow, setSeletedRow] = useState(null)
  // 지도에서 직접 짚어 만드는 새 POI 의 시작 좌표 — '추가' 버튼으로 만들 때는 없다(null).
  // SemanticDetail 의 initialPose 로 넘어간다(로봇 현재 위치보다 우선한다).
  const [createInitialPose, setCreateInitialPose] = useState(null)
  const [pois, setPois] = useState([])
  const [workingPois, setWorkingPois] = useState([])
  // Table 의 operation 필터(IN-USE/WORKING). SemanticTable 은 상세 진입 시 언마운트되므로
  // 필터가 리셋되지 않도록 여기(부모)에서 들고 있는다.
  const [operationMode, setOperationMode] = useState('IN-USE')
  const [semanticType, setSemanticType] = useState(SEMANTIC_TYPE_POI)

  // 가상 장애물 — POI 와 같은 구분을 쓴다: obstacles 는 저장된 것(IN-USE), workingObstacles 는
  // 작업본(WORKING). 편집은 작업본에만 하고, 임시 저장이 작업본을 저장 요청으로 보낸다
  // (onObstacleSave). 저장 결과는 앱이 다시 조회해 obstacleList 로 내려준다.
  const [obstacles, setObstacles] = useState([])
  const [workingObstacles, setWorkingObstacles] = useState([])
  // 다음에 추가할 형태(점/선분/사각형/폴리곤) — '가상 장애물 추가' 가 이 형태로 그리기를 시작한다.
  const [obstacleShape, setObstacleShape] = useState(OBSTACLE_SHAPE_RECTANGLE)
  // 목록/지도에 보여줄 타입 필터. 'ALL' 이면 전체다 — 저장 대상은 필터와 무관하게 작업본 전체다
  // (아래 handleObstacleSave 참고).
  const [obstacleTypeFilter, setObstacleTypeFilter] = useState(OBSTACLE_TYPE_FILTER_ALL)
  // 방금 그린 도형 — 타입/이름을 받는 모달이 열려 있는 동안만 존재한다({ shape, points }).
  // 확인을 누르면 작업본에 들어가고, 취소하면 버려진다.
  const [pendingObstacle, setPendingObstacle] = useState(null)
  // 모달 입력값. 타입은 마지막으로 쓴 값을 기본으로 이어 준다 — 같은 타입으로 여러 개를
  // 이어 그리는 것이 보통이다.
  const [pendingType, setPendingType] = useState(OBSTACLE_TYPE_OBJECT)
  const [pendingName, setPendingName] = useState('')
  // 지도에서 그리는 중인 형태. null 이면 꺼진 상태다. '가상 장애물 추가' 로 켜고, 도형 하나를
  // 확정하면 다시 꺼진다 — 켜져 있는 동안에는 지도 클릭이 그리기라 계속 켜 두면 안 된다.
  const [drawingShape, setDrawingShape] = useState(null)
  // 목록에서 고른 장애물 — 지도에서 그 도형만 강조한다(목록과 지도를 눈으로 잇는 용도).
  const [selectedObstacleId, setSelectedObstacleId] = useState(null)
  // 모양을 고치는 중인 장애물 — 지도에서 그 도형에만 꼭지점 손잡이가 붙는다.
  const [editingObstacleId, setEditingObstacleId] = useState(null)
  const [isSavingObstacles, setIsSavingObstacles] = useState(false)
  const isObstacleType = semanticType === SEMANTIC_TYPE_OBSTACLE
  const isWorking = operationMode === 'WORKING'
  // 가상 장애물을 고칠 수 있는 조건 — 작업본(WORKING)일 때만이다. IN-USE 는 저장된 결과를
  // 보여주는 읽기 전용 화면이라 POI 목록과 같은 규약을 따른다.
  const canEditObstacles = isObstacleType && isWorking

  // 고칠 수 없는 상태(POI 타입으로 되돌림, IN-USE 조회)에서는 그리기/꼭지점 편집을 끝낸다 —
  // 켜진 채로 남으면 지도 클릭만 막히고 결과는 어디에도 반영되지 않는다.
  // 확정되지 않은 도형(모달 대기)도 함께 버린다 — 편집할 수 없는 화면으로 넘어간 뒤 모달만
  // 남으면 확인을 눌러도 들어갈 곳이 없다.
  useEffect(() => {
    if (canEditObstacles) return
    setDrawingShape(null)
    setEditingObstacleId(null)
    setPendingObstacle(null)
  }, [canEditObstacles])

  // 지원 타입 목록이 비면(BE meta 조회 전·실패, 또는 모델이 아무 타입도 허용하지 않음)
  // 추가를 잠근다 — 목록에 없는 타입으로 그리면 저장할 때 BE 검증에서 400 이 난다.
  const canAddObstacle = canEditObstacles && obstacleTypes.length > 0

  useEffect(() => {
    if (canAddObstacle) return
    setDrawingShape(null)
    setPendingObstacle(null)
  }, [canAddObstacle])

  // 모달의 기본 타입을 지원 목록 안으로 맞춘다. 기본값(Object)이 모델에서 빠져 있으면
  // 그대로 두면 드롭다운이 빈 값으로 열리고, 확인을 누르면 400 이 난다.
  useEffect(() => {
    if (obstacleTypes.length === 0) return
    setPendingType((prev) => (obstacleTypes.includes(prev) ? prev : obstacleTypes[0]))
  }, [obstacleTypes])

  // 저장된 가상 장애물이 들어오면 작업본을 그 사본으로 다시 만든다(POI 의 inUsed 사본과 같은 규약).
  // 저장 직후 앱이 재조회한 결과도 이 경로로 들어오므로, 저장 성공이 곧 작업본 초기화다.
  useEffect(() => {
    const saved = Array.isArray(obstacleList) ? obstacleList : []
    setObstacles(saved)
    setWorkingObstacles(saved.map((obstacle) => ({ ...obstacle, editStatus: { inUsed: true } })))
    setDrawingShape(null)
    setEditingObstacleId(null)
    setSelectedObstacleId(null)
    setPendingObstacle(null)
  }, [obstacleList])

  /**
   * 지도가 도형을 확정했을 때 — 점 개수가 형태를 만족한 시점이다(점 1 / 선분 2 / 사각형 4 /
   * 폴리곤은 닫는 순간). 바로 목록에 넣지 않고 타입/이름을 받는 모달을 띄운다:
   * 타입은 로봇이 costmap 에 어떻게 찍을지를 정하는 값이라 그리는 순간 확정돼야 하고,
   * 이름은 여러 도형을 구분할 유일한 수단인데 나중에 몰아서 붙이면 어느 것이 무엇인지 모른다.
   *
   * 그리기 모드는 여기서 끈다 — 모달이 열린 동안 지도 클릭이 또 도형을 만들면 안 된다.
   */
  const handleObstacleDrawn = useCallback((drawn) => {
    setPendingObstacle({
      shape: drawn.shape ?? OBSTACLE_SHAPE_RECTANGLE,
      points: drawn.points ?? []
    })
    setPendingName('')
    setDrawingShape(null)
  }, [])

  /** 모달 확인 — 작업본에 넣는다. obsId(로봇 쪽 [type,id] 의 id)는 BE 가 타입별로 발급한다. */
  const handlePendingConfirm = useCallback(() => {
    if (!pendingObstacle) return
    // 저장 전까지 쓰는 화면 안의 식별자 — 선택/수정/삭제 대상을 가리키는 데만 쓴다.
    const id = `obstacle-${Date.now()}`
    setWorkingObstacles((prev) => [
      ...prev,
      {
        id,
        type: pendingType,
        name: pendingName.trim(),
        shape: pendingObstacle.shape,
        points: pendingObstacle.points,
        // 아직 저장되지 않은 새 장애물 — inUsed 가 없으므로 목록의 '사용 중' 칸도 비어 있다.
        editStatus: { needToSave: true }
      }
    ])
    setPendingObstacle(null)
    // 방금 넣은 도형을 골라 둔다 — 여러 개가 있을 때 어느 것이 새로 들어온 줄인지 보인다.
    setSelectedObstacleId(id)
    // 필터가 켜져 있으면 방금 넣은 것이 목록에서 사라져 "저장이 안 됐다" 로 보인다 —
    // 그 타입으로 필터를 옮겨 방금 넣은 줄이 보이게 한다.
    setObstacleTypeFilter((prev) =>
      prev === OBSTACLE_TYPE_FILTER_ALL || Number(prev) === Number(pendingType) ? prev : pendingType
    )
  }, [pendingObstacle, pendingType, pendingName])

  /** 모달 취소 — 그린 도형을 버린다(작업본에 들어가지 않는다). */
  const handlePendingCancel = useCallback(() => {
    setPendingObstacle(null)
  }, [])

  /** 작업본의 한 줄만 고친다 — 고친 줄은 저장 대상(needToSave)이 된다. */
  const patchWorkingObstacle = useCallback((id, patch) => {
    setWorkingObstacles((prev) =>
      prev.map((obstacle) =>
        obstacle.id === id
          ? {
              ...obstacle,
              ...(typeof patch === 'function' ? patch(obstacle) : patch),
              editStatus: { ...obstacle.editStatus, needToSave: true }
            }
          : obstacle
      )
    )
  }, [])

  /**
   * 사각형 모서리(크기 조절)나 회전 손잡이를 끄는 동안 작업본 좌표를 갱신한다 — 지도와 목록의
   * 좌표가 함께 따라온다. 지도가 이미 완성된 네 꼭지점(회전이 유지된 채 크기만 바뀌거나,
   * 중심을 기준으로 통째로 돌아간 좌표)을 만들어 주므로 여기서는 그대로 받는다.
   */
  const handleObstacleResize = useCallback(
    (id, rect) => {
      patchWorkingObstacle(id, { points: rect.points })
    },
    [patchWorkingObstacle]
  )

  /**
   * 점 하나를 옮긴다 — 나머지 점은 그대로 둔다(점/선분/폴리곤 공통).
   * 지도 조작은 x,y 만 주므로 z 는 원래 점의 값을 유지한다(x,y 만 덮어쓴다) — 여기서 새 객체를
   * 만들어 버리면 저장 payload 에서 z 가 빠져 다른 편집 경로와 형태가 갈린다.
   */
  const handleObstacleVertexMove = useCallback(
    (id, index, point) => {
      patchWorkingObstacle(id, (obstacle) => ({
        points: (obstacle.points ?? []).map((current, i) =>
          i === index ? { ...current, x: point.x, y: point.y } : current
        )
      }))
    },
    [patchWorkingObstacle]
  )

  /** 수정 버튼 — 같은 행을 다시 누르면 편집을 끝낸다. 편집 대상은 선택 대상도 된다. */
  const handleObstacleEditToggle = useCallback((id) => {
    setSelectedObstacleId(id)
    setEditingObstacleId((prev) => (prev === id ? null : id))
    // 그리기와 꼭지점 편집은 둘 다 지도 조작을 쓰므로 함께 켜 두지 않는다.
    setDrawingShape(null)
  }, [])

  /**
   * 삭제 — POI 와 같이 목록에서 바로 지우지 않고 삭제 예정(softDelete)으로 표시한다.
   * 임시 저장 전까지는 되돌릴 수 있어야 하고, 지도에서도 무채색으로 남아 무엇이 지워질지 보인다.
   */
  const handleObstacleDelete = useCallback((id) => {
    setWorkingObstacles((prev) =>
      prev.map((obstacle) =>
        obstacle.id === id
          ? { ...obstacle, editStatus: { ...obstacle.editStatus, softDelete: true, needToSave: true } }
          : obstacle
      )
    )
    // 지워질 도형을 계속 고치는 중으로 두면 지도에 손잡이만 남는다(선택은 그대로 둔다 —
    // 어느 줄을 지우기로 했는지 지도에서 확인해야 한다).
    setEditingObstacleId((prev) => (prev === id ? null : prev))
  }, [])

  const handleObstacleRestore = useCallback((id) => {
    setWorkingObstacles((prev) =>
      prev.map((obstacle) =>
        obstacle.id === id
          ? { ...obstacle, editStatus: { ...obstacle.editStatus, softDelete: false, needToSave: true } }
          : obstacle
      )
    )
  }, [])

  /**
   * 그리기 토글 — 지금 고른 형태로 시작하고, 다시 누르면 끈다.
   * 켜는 동안에는 꼭지점 편집을 끝낸다(지도 조작이 겹친다).
   */
  const handleObstacleDrawToggle = useCallback(() => {
    setDrawingShape((prev) => {
      if (prev) return null
      setEditingObstacleId(null)
      return obstacleShape
    })
  }, [obstacleShape])

  /**
   * 형태 변경 — 그리는 중이면 그 자리에서 새 형태로 갈아탄다(그리던 점은 버려진다).
   * 형태를 고를 때마다 추가 버튼을 다시 누르게 하지 않는 것이 목적이다: 사각형 하나, 선분 하나,
   * 점 하나를 이어 넣는 흐름이 보통이다.
   */
  const handleObstacleShapeChange = useCallback((shape) => {
    setObstacleShape(shape)
    setDrawingShape((prev) => (prev ? shape : prev))
  }, [])

  /**
   * 지도 위 조작 줄에 넘길 형태 목록 — 번역된 문구까지 만들어 넘긴다(지도 구현은 semantic
   * 번역을 모른다). 레퍼런스가 매 렌더 바뀌면 지도의 memo 비교가 늘 실패하므로 고정한다.
   */
  const obstacleShapeOptions = useMemo(
    () => OBSTACLE_SHAPES.map((value) => ({ name: t(`obstacleShapes.${value}`, value), value })),
    [t]
  )

  /**
   * 지금 그리는 중인 형태의 안내 문구 — 형태별 문구가 있으면 그것을, 없으면 공통 문구를 쓴다.
   * 폴리곤은 닫는 방법(우클릭/Enter/첫 점)까지 알려야 해서 문구가 따로다.
   */
  const obstacleDrawHint = useMemo(() => {
    if (!drawingShape) return ''
    if (drawingShape === OBSTACLE_SHAPE_POLYGON) return t('obstaclePolygonHint')
    return t(`obstacleDrawHint_${drawingShape}`, t('obstacleDrawHint'))
  }, [drawingShape, t])

  /** 타입 필터 — 'ALL' 또는 정수 타입. 목록과 지도에 같이 적용된다. */
  const handleObstacleTypeFilterChange = useCallback((value) => {
    if (value === OBSTACLE_TYPE_FILTER_ALL) {
      setObstacleTypeFilter(OBSTACLE_TYPE_FILTER_ALL)
      return
    }
    const type = Number(value)
    // 공용 Dropdown 은 value 가 0(falsy)일 때 라벨 문자열을 돌려준다 — 타입 목록에
    // 0(Unknown)이 들어오면 NaN 이 되므로 그때는 무시한다(엉뚱한 필터가 걸리지 않게).
    if (!Number.isInteger(type)) return
    setObstacleTypeFilter(type)
  }, [])

  /** 모달의 타입 선택 — 이 값이 다음 도형의 기본값으로도 이어진다. */
  const handlePendingTypeChange = useCallback((value) => {
    const type = Number(value)
    if (!Number.isInteger(type)) return
    setPendingType(type)
  }, [])

  /**
   * 가상 장애물 임시 저장.
   * 앱이 저장을 갖고 있으면(onObstacleSave) 작업본을 그대로 넘긴다 — 로봇 프로토콜이
   * full-state 라 BE 저장도 전체 치환이고, 삭제 예정은 "보내지 않는 것" 으로 표현된다.
   * 저장이 없으면 예전처럼 화면 안에서 IN-USE 로 옮기고 끝낸다.
   */
  const handleObstacleSave = useCallback(async () => {
    if (onObstacleSave) {
      setIsSavingObstacles(true)
      try {
        // 저장 결과는 앱이 재조회해 obstacleList 로 내려주고, 그때 위 effect 가 작업본을 다시 만든다.
        await onObstacleSave(workingObstacles)
      } finally {
        setIsSavingObstacles(false)
      }
      return
    }

    const saved = workingObstacles
      .filter((obstacle) => !obstacle.editStatus?.softDelete)
      // eslint-disable-next-line no-unused-vars
      .map(({ editStatus, ...obstacle }) => obstacle)
    setObstacles(saved)
    setWorkingObstacles(saved.map((obstacle) => ({ ...obstacle, editStatus: { inUsed: true } })))
    setEditingObstacleId(null)
    setDrawingShape(null)
  }, [onObstacleSave, workingObstacles])

  /** 취소 — 작업본을 저장된 것(IN-USE) 기준으로 되돌린다. */
  const handleObstacleCancel = useCallback(() => {
    setWorkingObstacles(obstacles.map((obstacle) => ({ ...obstacle, editStatus: { inUsed: true } })))
    setEditingObstacleId(null)
    setDrawingShape(null)
  }, [obstacles])

  // 지금 보고 있는 구분의 전체 목록 — IN-USE 는 저장된 것, WORKING 은 작업본이다.
  // 저장(handleObstacleSave)은 이 값이 아니라 workingObstacles 를 그대로 보낸다:
  // 화면 필터가 저장 범위를 바꾸면 필터를 걸어 둔 사이에 다른 타입이 전부 지워진다.
  const operationObstacles = useMemo(
    () => (isWorking ? workingObstacles : obstacles),
    [isWorking, workingObstacles, obstacles]
  )

  // 타입 필터를 적용한 목록 — 목록과 지도가 같은 것을 본다.
  const visibleObstacles = useMemo(() => {
    if (obstacleTypeFilter === OBSTACLE_TYPE_FILTER_ALL) return operationObstacles
    return operationObstacles.filter((obstacle) => Number(obstacle.type) === Number(obstacleTypeFilter))
  }, [operationObstacles, obstacleTypeFilter])

  useEffect(() => {
    const inUse = poiList.filter((poi) => !poi.editStatus)
    const working = poiList.filter((poi) => poi.editStatus)

    // poiId 기준으로 IN-USE 에는 있으나 WORKING 에 없는 POI 는 작업본으로 복사한다.
    const workingPoiIds = new Set(working.map((poi) => poi.poiId))
    const copies = inUse
      .filter((poi) => !workingPoiIds.has(poi.poiId))
      .map((poi) => ({ ...poi, editStatus: { inUsed: true } }))
    setPois(inUse)
    setWorkingPois([...working, ...copies])
    setLoading(true)
  }, [poiList])

  // 목록(SemanticTable)에 지금 보이는 POI — 지도도 같은 목록을 그린다.
  // IN-USE 는 저장된 POI, WORKING 은 작업본(미저장 생성/수정/삭제 예정 포함)이다.
  const visiblePois = useMemo(
    () => (operationMode === 'IN-USE' ? pois : workingPois),
    [operationMode, pois, workingPois]
  )

  const handleSave = () => {
    onSave(workingPois)
  }

  const handleCancel = () => {
    console.log('handleCancel')
    onCancel()
  }

  const handleCreate = () => {
    console.log('onCreate')
    // 목록의 '추가' 버튼으로 만드는 POI 는 지도에서 짚은 좌표가 없다 — 이전에 지도에서 짚어
    // 만들다 취소한 좌표가 남아 있으면 안 되므로 비운다.
    setCreateInitialPose(null)
    setSeletedRow(null)
    setMode('MODE_DETAIL')
  }

  /**
   * 지도를 짚어 그 자리에 POI 를 만든다 — 앱의 지도 말풍선(mapSlot)이 호출한다.
   * pose 는 앱이 지도 클릭으로 잡은 좌표다({ x, y, yaw? }, 로봇/지도와 같은 프레임).
   */
  const handleCreateAt = (pose) => {
    setCreateInitialPose(pose ?? null)
    setSeletedRow(null)
    setMode('MODE_DETAIL')
  }

  const handleCreated = (newObj) => {
    console.log('handleCreated newObj', newObj)
    setWorkingPois((prev) => [...prev, newObj])

    setCreateInitialPose(null)
    setSeletedRow(null)
    setMode('MODE_LIST')
    setOperationMode('WORKING')
  }

  const handlePoiDeleted = (ids) => {
    setWorkingPois((prev) =>
      prev.map((poi) =>
        ids.includes(poi.id)
          ? {
              ...poi,
              editStatus: {
                ...poi.editStatus,
                softDelete: true,
                needToSave: true
              }
            }
          : poi
      )
    )

    setSeletedRow(null)
    setMode('MODE_LIST')
  }

  const handlePoiRestore = (row) => {
    setWorkingPois((prev) =>
      prev.map((poi) =>
        poi.id === row.id
          ? {
              ...poi,
              editStatus: {
                ...poi.editStatus,
                softDelete: false,
                needToSave: true
              }
            }
          : poi
      )
    )
  }

  const handleEdited = (editedObj) => {
    console.log('onEdited')
    setWorkingPois((prev) => prev.map((poi) => (poi.poiId === editedObj.poiId ? editedObj : poi)))
    setSeletedRow(null)
    setMode('MODE_LIST')
    setOperationMode('WORKING')
  }

  const handleNameClick = (row) => {
    setSeletedRow(row)
    // IN-USE 는 읽기 전용 조회, WORKING 은 편집.
    setMode(operationMode === 'IN-USE' ? 'MODE_VIEW' : 'MODE_DETAIL')
  }

  const handlePoiCancel = () => {
    setCreateInitialPose(null)
    setSeletedRow(null)
    setMode('MODE_LIST')
  }

  return (
    loading && (
      // 페이지 껍데기(StyledPageContent/Title)는 앱 페이지가 갖고, 여기서는 Section 들만 내보낸다
      // — Section 안에 Section 을 겹치면 카드가 이중으로 보인다.
      <>
        {/* Command Button area */}
        <CommandBar>
          <Section>
            <CommandRow>
              <CommandFilters>
                <Dropdown
                  label={t('filterType')}
                  size="md"
                  value={semanticType}
                  // 타입 이름은 코드 값(POI/VIRTUAL-OBSTACLE)이라 그대로 보여줄 수 없다 — 번역이
                  // 없으면 값을 그대로 쓴다(BE 가 새 타입을 추가해도 목록은 그려진다).
                  options={SEMANTIC_TYPES.map((tp) => ({ name: t(`semanticTypes.${tp}`, tp), value: tp }))}
                  onChange={setSemanticType}
                />
                {/* IN-USE(저장된 것) / WORKING(작업본) — POI 와 가상 장애물이 같은 필터를 쓴다. */}
                <Dropdown
                  label={t('filterOperation')}
                  size="md"
                  value={operationMode}
                  options={OPERATION_TYPES.map((op) => ({ name: op, value: op }))}
                  onChange={setOperationMode}
                />
              </CommandFilters>
              {isWorking && (
                <CommandButtons>
                  {/* 저장/취소 대상은 지금 보고 있는 종류의 작업본이다.
                      POI 상세가 열려 있는 동안 잠그는 것은 POI 쪽 흐름에만 해당한다. */}
                  <Button
                    disabled={(!isObstacleType && mode === 'MODE_DETAIL') || (isObstacleType && isSavingObstacles)}
                    size="md"
                    onClick={isObstacleType ? handleObstacleSave : handleSave}
                  >
                    {t('tempSave')}
                  </Button>
                  <Button
                    theme="tertiary"
                    disabled={(!isObstacleType && mode === 'MODE_DETAIL') || (isObstacleType && isSavingObstacles)}
                    size="md"
                    onClick={isObstacleType ? handleObstacleCancel : handleCancel}
                  >
                    {tCommon('cancel')}
                  </Button>
                </CommandButtons>
              )}
            </CommandRow>
          </Section>
        </CommandBar>

        <SemanticWorkspace className="row">
          {/* Map — 지도와 목록이 같은 POI 를 보도록, 표시 중인 목록(visiblePois)을 그대로 넘긴다 */}
          <Section>
            {typeof mapSlot === 'function'
              ? mapSlot({
                  pois: visiblePois,
                  obstacles: visibleObstacles,
                  drawObstacleShape: drawingShape,
                  onObstacleDrawn: handleObstacleDrawn,
                  selectedObstacleId,
                  editingObstacleId,
                  onObstacleResize: handleObstacleResize,
                  onObstacleVertexMove: handleObstacleVertexMove,
                  // 그리기 중 지도 위 조작 줄 — 형태 선택/안내/찍은 좌표를 지도 보면서 다뤄야 한다.
                  obstacleShapeOptions,
                  onObstacleShapeChange: handleObstacleShapeChange,
                  obstacleShapeLabel: t('obstacleShape'),
                  obstacleDrawHint,
                  obstaclePointsLabel: t('obstacleColumns.points'),
                  // 폴리곤을 손가락으로 찍는 중에는 우클릭/Enter/Esc 를 쓸 수 없다 — 지도 위
                  // 완료/다시 찍기 버튼(MapCanvas)의 라벨을 여기서 번역해 넘긴다.
                  obstaclePolygonFinishLabel: t('obstaclePolygonFinish'),
                  obstaclePolygonRestartLabel: t('obstaclePolygonRestart'),
                  // 지도 말풍선의 'POI 등록' 버튼 — 탭한 좌표로 상세(생성) 모달을 연다.
                  // POI 타입(isObstacleType===false) + WORKING(isWorking) 조건에서만 의미가 있다 —
                  // 가상 장애물 화면과 IN-USE(저장된 결과를 보는 읽기 전용 화면)에는 버튼 자체를 넘기지 않는다.
                  onCreatePoiAt: !isObstacleType && isWorking ? handleCreateAt : undefined
                })
              : (mapSlot ?? 'Map')}
          </Section>
          {/* Pannel — 목록은 상세를 여는 동안에도 계속 보여준다(어느 POI 를 고쳤는지 보이도록) */}
          <Section>
            {isObstacleType ? (
              <ObstacleTable
                obstacles={visibleObstacles}
                // 편집(추가/수정/삭제)은 작업본에서만 — IN-USE 는 저장된 결과를 보는 화면이다.
                editable={canEditObstacles}
                // 추가만 따로 잠근다 — 지원 타입을 모르는 동안에도 수정/삭제는 되어야 한다.
                addDisabled={!canAddObstacle}
                // 형태 선택은 그리기 중 지도 위 조작 줄로 옮겼다 — 목록에는 필터와 추가 버튼만 둔다.
                drawingShape={drawingShape}
                types={obstacleTypes}
                // 타입 드롭다운은 목록/지도 필터다 — 새 도형의 타입은 그리기를 마친 뒤 모달에서 받는다.
                typeFilter={obstacleTypeFilter}
                filterAllValue={OBSTACLE_TYPE_FILTER_ALL}
                // 필터가 걸려 있으면 개수가 전체와 다르므로 함께 넘겨 목록에 같이 보여준다.
                totalCount={operationObstacles.length}
                selectedId={selectedObstacleId}
                editingId={editingObstacleId}
                onTypeFilterChange={handleObstacleTypeFilterChange}
                onDrawToggle={handleObstacleDrawToggle}
                onSelect={setSelectedObstacleId}
                onEditToggle={handleObstacleEditToggle}
                onDelete={handleObstacleDelete}
                onRestore={handleObstacleRestore}
              />
            ) : (
              <SemanticTable
                poiVersion={poiVersion}
                data={pois}
                workingData={workingPois}
                operationMode={operationMode}
                noData={noData}
                actionsDisabled={mode !== 'MODE_LIST'}
                onCreate={handleCreate} // create
                onNameClick={handleNameClick} // update
                onPoiDeleted={handlePoiDeleted} // delete
                onPoiRestore={handlePoiRestore} // restore
                onPoiCancel={handlePoiCancel}
                onPoiGoto={onPoiGoto} // goto — 실제 이동 명령은 앱이 갖는다
                gotoDisabled={gotoDisabled}
                gotoLabel={gotoLabel}
              ></SemanticTable>
            )}
          </Section>
        </SemanticWorkspace>

        {/* 상세/생성 폼 — 모달로 띄운다. 아래에 펼치면 지도·목록 높이만큼 밀려 폼이 화면 밖에서
            열렸다(스크롤해야 보였다).
            모달 헤더는 두지 않는다(title/closeButton 없음) — 제목과 취소/닫기 버튼을 이미
            SemanticDetail 이 갖고 있어 X 를 두면 닫는 길이 둘로 갈린다.
            onClose 는 남겨 둔다 — 공용 Modal 이 배경 클릭 닫기를 연결하면 그때 쓰인다.
            key 로 편집 대상이 바뀔 때 다시 마운트한다 — SemanticDetail 은 마운트 시점에만
            row 를 폼으로 옮기므로(useEffect deps []), 목록이 살아 있는 지금은 다른 POI 를
            눌러도 폼이 그대로 남는다. */}
        <Modal isOpen={mode !== 'MODE_LIST'} size="lg" onClose={handlePoiCancel}>
          <DetailModalBody>
            <SemanticDetail
              key={selectedRow?.poiId ?? 'new'}
              row={selectedRow}
              readOnly={mode === 'MODE_VIEW'}
              robotPose={robotPose}
              initialPose={createInitialPose}
              onPoiCreated={handleCreated}
              onPoiEdited={handleEdited}
              onPoiCancel={handlePoiCancel}
            ></SemanticDetail>
          </DetailModalBody>
        </Modal>

        {/* 새 가상 장애물의 타입/이름 — 지도에서 도형을 마친 직후(점 개수가 형태를 만족한 시점)
            열린다. 그리기 전에 물으면 무엇을 그릴지 정하지 않은 상태에서 속성을 먼저 정하게 되고,
            나중에 몰아서 붙이면 여러 도형 중 어느 것이 무엇인지 알 수 없다.
            취소는 그린 도형을 버린다 — 속성 없는 장애물을 목록에 남기지 않는다.
            배경 클릭(onClose)도 취소와 같게 둔다. */}
        <Modal
          isOpen={!!pendingObstacle}
          size="sm"
          title={t('obstacleNewTitle')}
          onClose={handlePendingCancel}
          renderButtonComponent={
            <>
              <Button size="lg" theme="tertiary" onClick={handlePendingCancel}>
                {tCommon('cancel')}
              </Button>
              <Button size="lg" onClick={handlePendingConfirm}>
                {tCommon('confirm')}
              </Button>
            </>
          }
        >
          <ObstacleFormBody>
            {/* 무엇을 그렸는지 먼저 보여준다 — 지도에서 손을 뗀 직후라 형태와 좌표가 확인돼야
                엉뚱한 도형에 타입/이름을 붙이지 않는다. 좌표는 목록/지도 조작 줄과 같은 표기다.
                MetaText 는 기본이 <p> 라 좌표 목록(div)을 담을 수 없다 — as 로 div 로 바꿔 쓴다. */}
            <MetaText as="div">
              {`${t('obstacleShape')}: `}
              <strong>
                {`${t(`obstacleShapes.${pendingObstacle?.shape}`, pendingObstacle?.shape ?? '')} · ` +
                  `${(pendingObstacle?.points ?? []).length}${t('obstaclePointUnit')}`}
              </strong>
            </MetaText>
            <MetaText as="div">
              {t('obstacleColumns.points')}
              <ObstaclePointList points={pendingObstacle?.points ?? []} />
            </MetaText>
            <Dropdown
              label={t('obstacleType')}
              size="md"
              value={pendingType}
              options={obstacleTypes.map((value) => ({ name: t(`obstacleTypes.${value}`, String(value)), value }))}
              onChange={handlePendingTypeChange}
            />
            {/* 이름은 라벨이라 비워도 된다 — 로봇 쪽 식별 키는 [type, obsId] 다. */}
            <Input
              label={t('obstacleName')}
              size="sm"
              maxLength={100}
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
            />
          </ObstacleFormBody>
        </Modal>
      </>
    )
  )
}

export default SemanticPage
