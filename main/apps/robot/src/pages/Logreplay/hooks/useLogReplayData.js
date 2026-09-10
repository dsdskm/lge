// hooks/useLogReplayData.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fileApis } from '@/apis'
import {
  extractFilenameFromContentDisposition,
  triggerAnchorDownload,
  compileKeywordMatcher
} from '../logReplayRender.js'
import useLogSearch from './useLogSearch.js'
import {
  loadPosesFromMcapUrl,
  loadRosoutFromMcapUrl,
  loadPosesSparseFromMcapUrl,
  loadOccupancyGridFromMcapUrl
} from '../mcap/mcapLoader.js'
import { toUtcFromLocalDateTime } from '@/utils/dateUtils'
import { format } from 'date-fns'
const lichtblickURL = import.meta.env.VITE_LICHTBLICK_BASE_URL

// ── 공통 헬퍼 (module-level) ─────────────────────────────
/** tSec ≤ t 인 마지막 인덱스 (없으면 -1) */
function bsearchLe(arr, t) {
  let lo = 0,
    hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((arr[mid]?.tSec ?? 0) <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** 가장 가까운 인덱스 */
function bsearchClosest(arr, t) {
  let lo = 0,
    hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((arr[mid]?.tSec ?? 0) < t) lo = mid + 1
    else hi = mid
  }
  if (lo >= arr.length) return arr.length - 1
  if (lo === 0) return 0
  return Math.abs(t - (arr[lo - 1]?.tSec ?? 0)) <= Math.abs((arr[lo]?.tSec ?? 0) - t) ? lo - 1 : lo
}

/** 정렬된 배열에서 동일 tSec 중복 제거(마지막 우선). 새 배열 반환 — O(n) */
function dedupeSortedByTSec(arr) {
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const cur = arr[i]
    if (out.length > 0 && out[out.length - 1].tSec === cur.tSec) out[out.length - 1] = cur
    else out.push(cur)
  }
  return out
}

function dedupeSortedLogEntries(arr) {
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const cur = arr[i]
    const prev = out.length > 0 ? out[out.length - 1] : null
    if (prev && prev.tSec === cur.tSec && prev.level === cur.level && prev.text === cur.text) out[out.length - 1] = cur
    else out.push(cur)
  }
  return out
}
const EMPTY_OPTION = { id: '__empty__', labelKey: 'logreplay.header.noFile' }

const TOPICS = {
  grid: '/carto_service/occupancygrid',
  trackedpose: '/carto_service/trackedpose',
  path: '/master_service/path',
  lidar: '/lidar_service/data',
  localCostmap: '/debug/dwa_local_costmap'
}

// ✅ 맵 통합 로더: pose 윈도우를 읽는 "같은 청크 스캔"에 costmap/path/goal을 편승시켜
//   같은 청크를 토픽마다 반복 압축해제하던 낭비를 제거한다(ReplayControls 편승 패턴 이식).
//   편승 대상 토픽(kind별 후보 + 다운샘플).
const MAP_EXTRA_TOPICS = [
  {
    kind: 'costmap',
    downsampleMs: 250,
    candidates: [
      '/local_costmap/costmap',
      '/global_costmap/costmap',
      '/debug/dwa_local_costmap',
      '/debug/dwa_global_costmap',
      '/local_costmap',
      '/global_costmap',
      '/costmap'
    ]
  },
  {
    kind: 'path',
    downsampleMs: 200,
    candidates: [
      '/plan',
      '/transformed_global_plan',
      '/master_service/path',
      '/path',
      '/trajectory',
      '/planned_path',
      '/plan_smoothed'
    ]
  },
  {
    kind: 'goal',
    downsampleMs: 0,
    candidates: ['/goal_pose', '/move_base_simple/goal', '/debug/dwa_goal', '/dwa_goal', '/goal']
  },
  {
    // ✅ 로컬 코스트맵이 odom 프레임으로 퍼블리시될 때 map 프레임으로 옮기기 위한 보정용.
    //   /carto_service/trackedpose(map, SLAM 보정됨)와의 시간 매칭 차이 = odom→map 보정값.
    kind: 'odomRaw',
    downsampleMs: 50,
    candidates: ['/odom']
  },
  {
    // ✅ 라이다 포인트 오버레이. 스캐너는 로봇 몸체에 고정된 프레임이라 costmap의 base 케이스처럼
    //   렌더 시점의 로봇 pose로 회전/평행이동한다(render2d.js).
    kind: 'lidar',
    downsampleMs: 80,
    candidates: ['/aslam/lidar/scan', '/scan', '/lidar_service/data', '/lidar/scan', '/laser/scan']
  }
]

export default function useLogReplayData({
  setPathPoints,
  setGridData,
  setLocalCostmapData,
  setLocalCostmapFrames,
  setPlannedPathPoints,
  setFullTrajectoryPoints,
  setOdomRawPoints,
  setLidarScans,
  setDwaGoals,
  setLoadPhase,
  setT0EpochMs,
  setDurationMs, // ✅ ADD
  updateBuffer,
  renderNow,
  resetView,
  deviceId,
  // ✅ [ADD] 플레이바 현재 재생 위치(초)를 가져오는 콜백 (0 ~ durationSec)
  getPlayTimeSec,
  // ✅ [ADD] 사용자 seek 카운터 getter — 변화 감지 시 pose 누적 캐시 리셋(연속 재생은 누적 유지)
  getSeekEpoch
}) {
  const { t } = useTranslation('robot')
  // 스트리밍 상태 ref
  const expectedDurationSecRef = useRef(0)
  const decodedSpanSecRef = useRef(0)
  const t0RawRef = useRef(null)
  const tLastRawRef = useRef(-Infinity)

  // ✅ [ADD] 현재 로드된 MCAP url / pose-window 요청 핸들러
  const currentMcapUrlRef = useRef('')
  const requestPoseWindowRef = useRef(null)
  const activePoseWindowRef = useRef({ startSec: null, endSec: null })
  const poseInflightRef = useRef(false) // pose 윈도우 로드 in-flight 가드(중복/파일업 방지 — finally에서 반드시 해제)
  // ✅ latest-wins: 로드 중에 들어온 요청을 버리지 않고 "가장 최신 것 하나"만 남겨뒀다가 완료 직후 실행한다.
  //    (과거: in-flight면 새 요청을 그냥 버렸다 → 러프하게 드래그하면 요청 104건 중 3건만 화면에 반영되고
  //     나머지는 사라져, 마우스를 놓은 최종 위치가 반영되지 않는 문제. 계측으로 확인 후 수정.)
  const pendingPoseReqRef = useRef(null) // { centerSec, reason } | null
  const poseTopicUnavailableRef = useRef(false) // ✅ 이 mcap엔 pose 토픽이 없음(또는 메시지 0개)이 확정되면 true — 이후 requestPoseWindow 호출 자체를 차단
  // ✅ grid가 크기 제한 초과로 폐기됨이 확정되면 true — 지도 위에 그릴 배경이 없으므로 그 위에 렌더링되는
  //    토픽(경로선/costmap/planned path/goal, 모두 requestPoseWindow 편승분)도 더 이상 요청하지 않음.
  //    (센서차트/로그 뷰어는 지도와 무관하게 그대로 로드됨 — requestChartOverview/requestLogWindow는 영향 없음)
  const gridOversizedRef = useRef(false)
  const poseWindowSeqRef = useRef(0)
  const lastPollCenterRef = useRef(null) // ✅ 폴링 게이트: 사용자 seek 감지용
  // ✅ [ADD][Option A] pose window 결과 캐시(플레이바 이동 시 네트워크 없이 여기서 선택)
  const poseWindowCacheRef = useRef([]) // [{x,y,yaw,tSec}]  (tSec: playback-relative sec)
  const lastPoseApplyIdxRef = useRef(-1)
  // ✅ 직전에 관측한 seek 카운터 — 값이 바뀌면 사용자 seek → 누적 캐시 리셋
  const lastSeekEpochRef = useRef(0)
  // ✅ seek 직후 첫 리로드에서 "데이터 없는 overlay 표시 비우기"를 1회 수행하기 위한 플래그.
  //    (seek 시 표시를 즉시 비우면 깜박임 → hold-last. 대신 리로드 후 빈 overlay만 정리해 ghost 방지)
  const overlayResyncPendingRef = useRef(false)

  // ✅ [ADD] odom(=pose) 기반 센서 차트 데이터 (uPlot용: {t[], x[], y[], z[]})
  const [odomChart1, setOdomChart1] = useState(null) // vx/vy/speed
  const [odomChart2, setOdomChart2] = useState(null) // x/y/yaw
  const [chartLoading, setChartLoading] = useState(false)

  // ✅ [ADD] 이 mcap 파일에 pose/grid 토픽이 없음(또는 메시지 0개)이 "확정"됐는지(로딩 중이 아니라 진짜 없음).
  //    UI가 "계속 기다리는 중" 스피너 대신 "이 로그엔 데이터가 없다" 안내를 보여줄 수 있도록 별도 state로 노출.
  const [poseUnavailable, setPoseUnavailable] = useState(false)
  const [gridUnavailable, setGridUnavailable] = useState(false)
  // ✅ [ADD] grid 토픽/메시지는 있었지만 전부 크기 제한(MAX_GRID_DIMENSION/MAX_GRID_CELLS) 초과로 폐기된 경우.
  //    gridUnavailable(=토픽 자체가 없음)과 원인이 달라 UI 안내 문구를 구분하기 위해 별도로 둔다.
  const [gridOversized, setGridOversized] = useState(false)

  // ✅ [ADD] pose window -> chart data 변환 유틸
  const buildOdomChartsFromPoses = useCallback((poses) => {
    if (!Array.isArray(poses) || poses.length < 2) return { c1: null, c2: null }

    // chart2: x/y/yaw (그대로)
    const t2 = []
    const x2 = []
    const y2 = []
    const z2 = [] // yaw

    for (const p of poses) {
      const t = Number(p?.tSec)
      const x = Number(p?.x)
      const y = Number(p?.y)
      const yaw = Number(p?.yaw) || 0
      if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue
      t2.push(t)
      x2.push(x)
      y2.push(y)
      z2.push(yaw)
    }

    // chart1: vx/vy/speed (차분으로 계산)
    const t1 = []
    const x1 = [] // vx
    const y1 = [] // vy
    const z1 = [] // speed
    for (let i = 1; i < poses.length; i++) {
      const p0 = poses[i - 1]
      const p1 = poses[i]
      const t0 = Number(p0?.tSec)
      const t = Number(p1?.tSec)
      const dt = t - t0
      if (!(Number.isFinite(dt) && dt > 0)) continue
      const x0 = Number(p0?.x),
        y0 = Number(p0?.y)
      const x = Number(p1?.x),
        y = Number(p1?.y)
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x) || !Number.isFinite(y)) continue
      const vx = (x - x0) / dt
      const vy = (y - y0) / dt
      t1.push(t)
      x1.push(vx)
      y1.push(vy)
      z1.push(Math.hypot(vx, vy))
    }

    const c1 = t1.length ? { t: t1, x: x1, y: y1, z: z1 } : null
    const c2 = t2.length ? { t: t2, x: x2, y: y2, z: z2 } : null
    return { c1, c2 }
  }, [])

  // ✅ [ADD] rosout(window) 동기화용 refs (pose와 동일 패턴)
  const requestLogWindowRef = useRef(null)
  const activeLogWindowRef = useRef({ startSec: null, endSec: null })
  const logWindowSeqRef = useRef(0)
  // ✅ in-flight 가드: 고배속 폴링에서 log 윈도우가 동시 다발로 실행돼 fetch 큐를 점유하고
  //    pose 로더를 굶기는 것을 방지(한 번에 하나만). pose(poseInflightRef)와 동일 패턴.
  const logWindowInflightRef = useRef(false)
  const logWindowCacheRef = useRef([]) // [{tSec, epochMs, level, text}] sorted
  const lastLogApplyIdxRef = useRef(-1)
  const appliedKeywordRef = useRef('')
  // ✅ appliedKeywordRef가 바뀔 때만 재컴파일(매 tick마다 정규식 재생성 방지). "/pattern/flags"면 정규식 매칭.
  const compiledKeywordMatcherRef = useRef(null)

  // ✅ [ADD] 누적/seek 모드 구분
  const logAccModeRef = useRef('seek') // 'seek' | 'accumulate'
  const accStartSecRef = useRef(0) // 누적 시작 시점(seek 시점)
  const accEndCoveredRef = useRef(0) // 누적 캐시가 커버하는 최대 tSec

  // ✅ [ADD] TDZ 회피: polling/useEffect에서 applyLogsByPlayhead를 deps로 직접 참조하지 않기 위한 ref
  const applyLogsByPlayheadRef = useRef(null)
  // ── 공통 overlay window refs (costmap / path / goalPose) ──
  const overlayRef = useRef({
    costmap: { seq: 0, cache: [], active: { s: null, e: null }, lastIdx: -1, inflight: false },
    path: { seq: 0, cache: [], active: { s: null, e: null }, lastIdx: -1, inflight: false },
    goalPose: { seq: 0, cache: [], active: { s: null, e: null }, lastIdx: -1, inflight: false },
    // ✅ odom→map 보정용 raw odom 시계열(재생 위치 선택 없이 전체 구간을 그대로 씀)
    odomRaw: { seq: 0, cache: [], active: { s: null, e: null }, lastIdx: -1, inflight: false },
    lidar: { seq: 0, cache: [], active: { s: null, e: null }, lastIdx: -1, inflight: false }
  })
  const requestChartOverviewRef = useRef(null)

  const timebaseReadyRef = useRef(false)

  const gridDoneRef = useRef(false)
  const t0EpochMsRef = useRef(null) //ADD: playback 기준점(ms)

  // ✅ ADD: replay session clear (날짜/로그 변경 시)
  const clearReplaySession = useCallback(() => {
    currentMcapUrlRef.current = ''

    requestPoseWindowRef.current = null
    requestLogWindowRef.current = null

    activePoseWindowRef.current = { startSec: null, endSec: null }
    poseInflightRef.current = false
    logWindowInflightRef.current = false
    activeLogWindowRef.current = { startSec: null, endSec: null }
    for (const key of Object.keys(overlayRef.current)) overlayRef.current[key].inflight = false

    poseWindowCacheRef.current = []
    logWindowCacheRef.current = []

    lastPollCenterRef.current = null
    lastPoseApplyIdxRef.current = -1
    lastLogApplyIdxRef.current = -1

    // ✅ ADD: log UI state 초기화
    setLogLines([])
    setFilteredLines([])
    setLogError(null)
    setIsLoadingLogs(false)
    setOdomChart1(null)
    setOdomChart2(null)
  }, [])

  // 서버 옵션/상태
  // 로컬(KST) 기준 오늘. toISOString(UTC)은 KST 새벽(자정~09시)에 전날로 밀려 기본 날짜가 하루 어긋난다.
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const [logOptions, setLogOptions] = useState([EMPTY_OPTION])
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [selectedLogId, setSelectedLogId] = useState(EMPTY_OPTION.id)

  // 캘린더 가용 날짜 (yyyy-MM-dd 배열)
  const [allowedDateKeys, setAllowedDateKeys] = useState(null)

  // 텍스트 로그/검색
  const [logLines, setLogLines] = useState([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  const [logError, setLogError] = useState(null)
  const [filteredLines, setFilteredLines] = useState([])

  const MAX_FILTER_VIEW = 12000 // UI 표시 한정, 전부 메모리에 복제하지 않음
  const [hasAnyTarLogs] = useState(false)
  const [levelFilter, setLevelFilter] = useState({ INFO: true, WARN: true, ERROR: true, DEBUG: true, FATAL: true })

  const activeLevels = useMemo(
    () =>
      Object.entries(levelFilter)
        .filter(([, v]) => v)
        .map(([k]) => k),
    [levelFilter]
  )
  const activeLevelsRef = useRef(activeLevels)
  useEffect(() => {
    activeLevelsRef.current = activeLevels
  }, [activeLevels])

  const [pendingKeyword, setPendingKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')

  const { ready: searchReady, add: searchAdd, clear: searchClear, query: searchQuery } = useLogSearch()
  // ✅ searchAdd는 useLogSearch 내부에서 stats.count에 따라 참조가 바뀜(불안정) —
  //    handleViewLog(등) deps에 직접 넣으면 로그 인덱싱마다 재생성되므로 ref로 감싸 안정화.
  const searchAddRef = useRef(searchAdd)
  useEffect(() => {
    searchAddRef.current = searchAdd
  }, [searchAdd])
  const logSeqRef = useRef(0)

  // ✅ tick의 정상 재생 step(초) EMA
  const stepEmaRef = useRef(0)
  // ✅ tick()의 "마지막으로 관찰한 seekEpoch" — RAF 루프(overlay 리셋용)와는 별개로 자체 추적
  const lastSeekEpochForTickRef = useRef(0)

  const [isLoadingTar] = useState(false)
  const [tarError] = useState(null)

  const isLoadingLogsRef = useRef(false)
  useEffect(() => {
    isLoadingLogsRef.current = isLoadingLogs
  }, [isLoadingLogs])
  // 오버레이/게이팅
  const [loadPhase, _setLoadPhase] = useState('init')
  useEffect(() => {
    setLoadPhase?.(loadPhase)
  }, [loadPhase, setLoadPhase])
  const rightOverlayVisible = useMemo(() => loadPhase === 'init' || loadPhase === 'error', [loadPhase])
  const rightOverlayText = useMemo(
    () =>
      loadPhase === 'init'
        ? t('logreplay.map.initialHint')
        : loadPhase === 'error'
          ? t('logreplay.map.loadFailed')
          : '',
    [loadPhase, t]
  )
  // presigned URL
  const presignedCacheRef = useRef(new Map())
  const getPresignedUrl = useCallback(async (fileId) => {
    if (!fileId || fileId === EMPTY_OPTION.id) return ''
    const cached = presignedCacheRef.current.get(fileId)
    const now = Date.now()
    if (cached && cached.expiresAt && cached.expiresAt - now > 10_000) return cached.url
    const resp = await fileApis.getFilesDownloardurl(fileId)
    const url = resp?.presignedUrl || ''
    if (!url) return ''
    try {
      const u = new URL(url)
      const expiresSec = Number(u.searchParams.get('X-Amz-Expires') || '0')
      const expiresAt = now + Math.max(0, expiresSec - 30) * 1000
      presignedCacheRef.current.set(fileId, { url, expiresAt })
    } catch (e) {
      console.warn('[Logreplay] presigned URL 파싱 실패:', e?.message || String(e))
    }
    return url
  }, [])

  const applyOverlayByPlayhead = useCallback(
    (playSec) => {
      const t = Number(playSec)
      if (!Number.isFinite(t)) return
      const ov = overlayRef.current

      // ⚠️ "가장 가까운 것"을 거리 제한 없이 그냥 쓰면 안 된다. costmap/lidar가 파일에서 뭉쳐서(burst)
      //   발행되는 경우, 현재 위치 근처에 데이터가 전혀 없어도 "그나마 가장 가까운" 후보가 수십~수백초
      //   떨어진 것일 수 있다 — 그걸 그대로 표시하면 로봇과 무관한 엉뚱한 데이터가 보인다.
      //   MAX_STALE_SEC보다 멀면 "데이터 없음"으로 취급해 표시를 비운다(틀린 것보다 안 보이는 게 낫다).
      const MAX_STALE_SEC = 5

      // ── costmap: 가장 가까운 프레임의 grid ──
      const cm = ov.costmap
      if (cm.cache.length > 0) {
        const idx = bsearchClosest(cm.cache, t)
        const pickedT = cm.cache[idx]?.tSec
        const tooFar = !Number.isFinite(pickedT) || Math.abs(pickedT - t) > MAX_STALE_SEC
        if (idx !== cm.lastIdx || tooFar !== cm.lastTooFar) {
          cm.lastIdx = idx
          cm.lastTooFar = tooFar
          if (tooFar) {
            setLocalCostmapData?.(null)
            setLocalCostmapFrames?.([])
          } else {
            const frame = cm.cache[idx]
            if (frame?.grid) {
              setLocalCostmapData?.(frame.grid)
              setLocalCostmapFrames?.(cm.cache)
            }
          }
          renderNow?.()
        }
      }

      // ── path: playhead 시점의 "그 시각 이전 최신" plan의 points ──
      const pt = ov.path
      if (pt.cache.length > 0) {
        const idx = bsearchLe(pt.cache, t)
        if (idx < 0) {
          // ✅ 재생 위치보다 앞선 plan이 캐시에 없다 → 화면에 남아 있는 건 "다른 시각의 계획"이므로 비운다.
          //    (뒤로 점프한 직후 등에 발생. 예전에는 idx<0이면 아무것도 하지 않아 옛 계획이 그대로 남았고,
          //     그래서 현재 재생 위치와 전혀 맞지 않는 경로가 표시됐다.)
          if (pt.lastIdx !== -1) {
            pt.lastIdx = -1
            setPlannedPathPoints?.([])
            renderNow?.()
          }
        } else if (idx !== pt.lastIdx) {
          pt.lastIdx = idx
          setPlannedPathPoints?.(pt.cache[idx]?.points ?? [])
          renderNow?.()
        }
      }

      // ── goalPose: playhead 시점의 최신 goal ──
      const gp = ov.goalPose
      if (gp.cache.length > 0) {
        const idx = bsearchLe(gp.cache, t)
        if (idx >= 0 && idx !== gp.lastIdx) {
          gp.lastIdx = idx
          setDwaGoals?.([gp.cache[idx]])
          renderNow?.()
        }
      }

      // ── lidar: 가장 가까운 시각의 스캔 1개만 표시(costmap과 동일한 nearest 정책 + 거리 제한) ──
      const ld = ov.lidar
      if (ld.cache.length > 0) {
        const idx = bsearchClosest(ld.cache, t)
        const pickedT = ld.cache[idx]?.tSec
        const tooFar = !Number.isFinite(pickedT) || Math.abs(pickedT - t) > MAX_STALE_SEC
        if (idx !== ld.lastIdx || tooFar !== ld.lastTooFar) {
          ld.lastIdx = idx
          ld.lastTooFar = tooFar
          setLidarScans?.(tooFar ? [] : [ld.cache[idx]])
          renderNow?.()
        }
      }
    },
    [setLocalCostmapData, setLocalCostmapFrames, setPlannedPathPoints, setDwaGoals, setLidarScans, renderNow]
  )
  useEffect(() => {
    if (typeof getPlayTimeSec !== 'function') return

    let lastLogApplySec = Number.NaN // 로그 apply 게이트(기존 유지)

    const tick = () => {
      if (!currentMcapUrlRef.current) return

      const exp = Number(expectedDurationSecRef.current) || 0
      if (!(exp > 0)) return

      let center = Number.NaN
      try {
        center = Number(getPlayTimeSec())
      } catch {}
      if (!Number.isFinite(center)) return

      // clamp
      if (center < 0) center = 0
      if (center > exp) center = exp

      // 이전 center
      const last = lastPollCenterRef.current

      // ✅ 재생 중 소폭 backward jitter 방지: playhead 단조 증가로 clamp
      let centerAdj = center
      const backJitterThresh = Math.max(0.8, (stepEmaRef.current || 0.25) * 4) // ★ 포인트
      if (Number.isFinite(last) && centerAdj < last && last - centerAdj < backJitterThresh) {
        centerAdj = last
      }
      const diffSec = Number.isFinite(last) ? centerAdj - last : 0
      lastPollCenterRef.current = centerAdj

      // ✅ 1) "정지/idle" 게이트: center가 거의 안 움직이면 아무 것도 하지 않음
      // - paused 상태에서 requestLogWindow가 계속 돌며 누적이 꼬이는 현상 방지
      // - 콘솔 로그 무한 출력도 방지
      if (Number.isFinite(last) && Math.abs(diffSec) < 0.02) {
        return
      }

      // ✅ seek 판정(핵심): 추측하지 않고 seekEpochRef(사용자 명시적 조작) 신호만 본다.
      //   player2D가 진행바 드래그/프레임 스텝/재시작에서만 증가시키는 카운터라, 연속 재생 중엔
      //   절대 안 바뀐다 — diffSec/getIsPlaying 추측과 달리 타이밍 우연으로 오탐할 수 없다.
      const curSeekEpoch = typeof getSeekEpoch === 'function' ? Number(getSeekEpoch()) || 0 : 0
      const isSeek = curSeekEpoch !== lastSeekEpochForTickRef.current
      lastSeekEpochForTickRef.current = curSeekEpoch

      // ✅ 정상 재생 step(초) EMA — backJitterThresh(위쪽)에서만 사용. seek 틱은 반영 안 함(이전과 동일한 보호).
      if (!isSeek && Number.isFinite(diffSec) && diffSec > 0.01 && diffSec < 60) {
        const prev = stepEmaRef.current || diffSec
        stepEmaRef.current = prev * 0.8 + diffSec * 0.2
      }

      // pose window는 재생 중에도 계속 호출(커버되면 loader가 skip)
      // overlay(costmap/path/goal)는 pose 스캔에 편승해 함께 로드되므로 개별 요청 불필요.
      requestPoseWindowRef.current?.(center, isSeek ? 'seek' : 'playhead')
      // ✅ 6) log window 모드 전환
      if (isSeek) {
        // seek → 누적 리셋, 해당 시점 윈도우만 표시
        logAccModeRef.current = 'seek'
        logWindowCacheRef.current = []
        lastLogApplyIdxRef.current = -1
        accStartSecRef.current = center
        accEndCoveredRef.current = 0
        requestLogWindowRef.current?.(center, 'seek')
      } else {
        // 연속 재생 → 누적 모드
        logAccModeRef.current = 'accumulate'
        requestLogWindowRef.current?.(center, 'playhead')
      }

      // ✅ buffer = 로그 존재 영역 표시
      const dur = Number(expectedDurationSecRef.current) || 1
      if (dur > 0) {
        if (isSeek) {
          // ✅ seek는 "점 표시" → 음수로 전달
          const r = Math.max(0, Math.min(1, centerAdj / dur))
          updateBuffer?.(-r)
        } else {
          // ✅ 재생 중 → on-demand HTTP Range이므로 buffer는 항상 100%
          updateBuffer?.(1)
        }
      }

      // ✅ 7) applyLogs 게이트 (기존 0.05초 + 추가로 "실제 변화" 기반)
      if (!Number.isFinite(lastLogApplySec) || Math.abs(center - lastLogApplySec) > 0.05) {
        lastLogApplySec = center
        applyLogsByPlayheadRef.current?.(center)
        // overlay 적용은 RAF 루프(아래 useEffect)에서 단일 처리 — 중복 호출 제거
      }
    }

    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [getPlayTimeSec, getSeekEpoch])

  const queryWindow = useCallback(
    async ({ levels, keyword = '', fromMs, toMs, limit = 5000 } = {}) => {
      if (!searchReady) return []
      const timeRange =
        Number.isFinite(fromMs) && Number.isFinite(toMs) ? { from: Math.round(fromMs), to: Math.round(toMs) } : null
      const res = await searchQuery({
        levels,
        keyword,
        sortBy: timeRange ? 'pbAsc' : 'tsAsc',
        limit,
        timeRange
      })
      const items = Array.isArray(res?.items) ? res.items : []
      return items.map((it) => it?.text).filter(Boolean)
    },
    [searchReady, searchQuery]
  )
  //캘린더에 해당하는는 파일 목록 조회
  const handleVisibleRangeChange = useCallback(
    async ({ startDate, endDate }) => {
      const toDateKey = (v) => {
        if (!v) return ''
        const d = typeof v === 'string' ? new Date(v) : v
        // 로컬(KST) 기준 키. toISOString(UTC)은 그리드 경계 날짜를 하루 밀어 마지막 날 로그를 누락시킬 수 있음.
        return isNaN(d) ? '' : format(d, 'yyyy-MM-dd')
      }

      const startKey = toDateKey(startDate)
      const endKey = toDateKey(endDate)
      if (!startKey || !endKey) return

      const start = toUtcFromLocalDateTime(startKey, '00:00:00')
      const end = toUtcFromLocalDateTime(endKey, '23:59:59')

      try {
        const size = 100
        const params = deviceId ? { start, end, deviceId, size } : { start, end }
        const items = (await fileApis.getFiles(params))?.content ?? []

        const dates = Array.from(
          new Set(
            items
              .map((it) => it?.createdAt && new Date(it.createdAt))
              .filter((d) => d && !isNaN(d))
              // 로컬(KST) 기준 키. toISOString(UTC)은 KST 오전 로그를 전날로 밀어 당일 클릭이 막히던 버그 방지.
              .map((d) => format(d, 'yyyy-MM-dd'))
          )
        ).sort()

        setAllowedDateKeys(dates)
      } catch (e) {
        console.error('[Logreplay] 가능 날짜 조회 실패:', e)
        setAllowedDateKeys([])
      }
    },
    [deviceId]
  )

  // 현재 달(캘린더 6주 그리드)의 가시 범위를 계산
  const computeVisibleRangeForMonth = useCallback((yyyyMMdd) => {
    const base = (() => {
      const [y, m] = (yyyyMMdd || '').split('-').map(Number)
      return Number.isFinite(y) && Number.isFinite(m)
        ? new Date(y, m - 1, 1)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    })()

    const start = new Date(base)
    start.setDate(1 - start.getDay()) // 달력 첫 셀

    const end = new Date(start)
    end.setDate(start.getDate() + 41) // 6주

    return { startDate: start, endDate: end }
  }, [])

  // [핵심] 첫 진입 시, Calendar가 자동 호출해주지 않으니 우리가 직접 1회 호출
  useEffect(() => {
    const { startDate, endDate } = computeVisibleRangeForMonth(selectedDate)
    handleVisibleRangeChange({ startDate, endDate })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 파일 목록 조회
  const handleFetchListClick = useCallback(async () => {
    try {
      const start = toUtcFromLocalDateTime(selectedDate, '00:00:00')
      const end = toUtcFromLocalDateTime(selectedDate, '23:59:59')

      // deviceId가 존재하면 옵션에 포함 (없으면 제외)
      const size = 100 //temp code
      const params = deviceId ? { start, end, deviceId, size } : { start, end }
      const response = await fileApis.getFiles(params)
      const items = Array.isArray(response?.content) ? response.content : []
      const nextOptionsRaw = items.map((it) => ({
        id: it.fileId,
        label: it.fileOriginalName || it.fileId,
        createdAt: it.createdAt,
        size: it.fileSize
      }))
      const nextOptions = nextOptionsRaw.length > 0 ? nextOptionsRaw : [EMPTY_OPTION]
      setLogOptions(nextOptions)
      if (!nextOptions.some((o) => o.id === selectedLogId)) {
        setSelectedLogId(nextOptions[0].id)
      }
    } catch (e) {
      console.warn('[Logreplay] 로그 목록 조회 실패:', e?.message || String(e))
      setLogOptions([EMPTY_OPTION])
      setSelectedLogId(EMPTY_OPTION.id)
    }
  }, [selectedDate, selectedLogId, deviceId])

  // 선택 변경 (초기화는 상위 훅에서)
  const onDateChange = useCallback((date) => {
    setSelectedDate(date)
  }, [])
  const onLogChange = useCallback((value) => {
    setSelectedLogId(value)
  }, [])

  // 키워드 검색 버튼
  const searchReadyRef = useRef(false)
  useEffect(() => {
    searchReadyRef.current = !!searchReady
  }, [searchReady])
  const pendingKeywordRef = useRef('')
  useEffect(() => {
    pendingKeywordRef.current = pendingKeyword
  }, [pendingKeyword])

  // ✅ [Option A] playhead(tSec)에 맞는 pose를 캐시에서 골라 pathPoints를 "현재까지"로 갱신
  // ✅ [REPLACE] applyPoseByPlayhead
  const applyPoseByPlayhead = useCallback(
    (playSec) => {
      const t = Number(playSec)
      if (!Number.isFinite(t)) return

      const poses = poseWindowCacheRef.current
      if (!Array.isArray(poses) || poses.length === 0) {
        // 캐시가 비어 있으면(초기/seek 직후) 현재 위치 윈도우를 요청해 다시 채운다.
        requestPoseWindowRef.current?.(t, 'seek')
        return
      }

      const minT = Number(poses[0]?.tSec)
      const maxT = Number(poses[poses.length - 1]?.tSec)
      // 캐시가 t를 충분히 못 덮으면 새 윈도우를 "요청만" 하고 return하지 않는다.
      //   ⚠️ 과거 버그: 여기서 return하면 로봇이 아예 안 그려짐 — 특히 t=0인데 첫 포즈가 0.15s인 시작 시점.
      //   아래 binary search가 idx를 0(또는 last)로 clamp하므로 로봇은 가장 가까운 포즈로 계속 표시된다.
      //   pad(0.5s)는 시작 갭(t=0 vs minT=0.15) 같은 미세 차이로 윈도우 요청이 스팸되는 것을 막는다.
      const OUT_PAD = 0.5
      if (Number.isFinite(minT) && Number.isFinite(maxT) && (t < minT - OUT_PAD || t > maxT + OUT_PAD)) {
        requestPoseWindowRef.current?.(t, 'seek')
      }

      let lo = 0
      let hi = poses.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const mt = Number(poses[mid]?.tSec)
        if (Number.isFinite(mt) && mt < t) lo = mid + 1
        else hi = mid
      }

      let idx
      if (lo <= 0) idx = 0
      else if (lo >= poses.length) idx = poses.length - 1
      else {
        const p0 = poses[lo - 1]
        const p1 = poses[lo]
        const t0 = Number(p0?.tSec)
        const t1 = Number(p1?.tSec)
        const d0 = Math.abs(t - t0)
        const d1 = Math.abs(t1 - t)
        idx = d0 <= d1 ? lo - 1 : lo
      }

      if (!poses[idx]) {
        return
      }

      if (idx === lastPoseApplyIdxRef.current) return
      lastPoseApplyIdxRef.current = idx

      if (poses.length === 1) {
        const p = poses[0]
        setPathPoints?.([p, { ...p, tSec: Number(p.tSec) + 1e-6 }])
        renderNow?.()
        return
      }

      const end = Math.min(poses.length, Math.max(2, idx + 1))
      setPathPoints?.(poses.slice(0, end))
      renderNow?.()
    },
    [setPathPoints, renderNow]
  )

  // ✅ [ADD] playhead 기준 로그 표시 (window cache에서 선택)
  // force=true: endIdx(재생 위치)가 이전과 같아도 강제로 재계산.
  //   키워드/레벨 필터만 바뀌고 재생 위치는 그대로인 경우(예: 정지 상태에서 검색)
  //   endIdx 게이트에 걸려 필터가 적용되지 않고 하이라이트만 되는 문제를 방지한다.
  const applyLogsByPlayhead = useCallback(
    (playSec, force = false) => {
      const entries = logWindowCacheRef.current

      if (!Array.isArray(entries) || entries.length === 0) return

      const t = Number(playSec)
      if (!Number.isFinite(t)) return

      // binary search: tSec <= t 인 마지막 인덱스(+1)
      let lo = 0
      let hi = entries.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const mt = Number(entries[mid]?.tSec)
        if (Number.isFinite(mt) && mt <= t) lo = mid + 1
        else hi = mid
      }
      const endIdx = lo

      if (!force && endIdx === lastLogApplyIdxRef.current) return
      lastLogApplyIdxRef.current = endIdx

      const visible = endIdx <= 1 ? entries : entries.slice(0, endIdx)

      // 레벨/키워드 필터(현재 상태 기준)
      const levels = activeLevelsRef.current || []
      const keywordRaw = appliedKeywordRef.current || ''

      let filtered = visible
      if (levels.length && levels.length < 5) {
        filtered = filtered.filter((e) => levels.includes(e.level))
      }
      if (keywordRaw) {
        // ✅ "/pattern/flags" 형태면 정규식으로, 아니면 대소문자무시 부분일치로 매칭
        //    (하이라이트와 동일한 파싱 규칙 — compileKeywordMatcher/parseSlashRegex 공유)
        const matcher = compiledKeywordMatcherRef.current || compileKeywordMatcher(keywordRaw)
        filtered = filtered.filter((e) => matcher(e.text))
      }

      // ✅ 실제 표시 범위 계산
      const baseSlice = visible.length > MAX_FILTER_VIEW ? visible.slice(-MAX_FILTER_VIEW) : visible
      const filtSlice = filtered.length > MAX_FILTER_VIEW ? filtered.slice(-MAX_FILTER_VIEW) : filtered

      // ✅ 이전과 길이가 같으면 setState 스킵 (새 배열 참조로 인한 불필요 리렌더 방지)
      //   force=true(키워드/필터 변경 직후)일 때는 내용이 바뀌었어도 길이가 우연히 같을 수 있으므로
      //   길이 비교로 스킵하지 않고 항상 갱신한다.
      setLogLines((prev) => {
        if (!force && prev.length === baseSlice.length) return prev
        return baseSlice.map((e) => e.text)
      })
      setFilteredLines((prev) => {
        if (!force && prev.length === filtSlice.length) return prev
        return filtSlice.map((e) => e.text)
      })
    },
    [setLogLines, setFilteredLines]
  )

  // ✅ [ADD] polling에서 호출할 수 있도록 ref에 연결 (TDZ 회피)
  useEffect(() => {
    applyLogsByPlayheadRef.current = applyLogsByPlayhead
  }, [applyLogsByPlayhead])
  // ── overlay playhead 적용 (costmap/path/goal 일괄) ──

  // ✅ 재생 위치가 그대로여도(정지 상태) 로그 필터를 강제로 즉시 재적용.
  //   키워드 검색/레벨 필터 토글처럼 "재생 위치는 안 바뀌었는데 필터 기준만 바뀐" 경우에 사용.
  //   (endIdx 게이트 때문에 다음 250ms tick까지 기다려도 반영 안 되는 문제 방지)
  const reapplyLogFilterNow = useCallback(() => {
    try {
      const t = typeof getPlayTimeSec === 'function' ? Number(getPlayTimeSec()) : Number.NaN
      if (Number.isFinite(t)) applyLogsByPlayheadRef.current?.(t, true)
    } catch {}
  }, [getPlayTimeSec])

  const handleKeywordSearchClick = useCallback(async () => {
    const keyword = (pendingKeywordRef.current || '').trim()

    // 키워드는 logWindowCache 기반 ref 필터(applyLogsByPlayhead)로 반영
    appliedKeywordRef.current = keyword
    compiledKeywordMatcherRef.current = compileKeywordMatcher(keyword)
    setAppliedKeyword(keyword)

    reapplyLogFilterNow()
  }, [reapplyLogFilterNow])

  // ✅ 레벨 체크박스 토글. activeLevelsRef를 "먼저" 동기적으로 갱신한 뒤 강제 재적용해야 한다.
  //   setLevelFilter(state)만 하면 activeLevelsRef는 useEffect(다음 렌더 이후)에야 갱신되므로,
  //   그 직후 reapplyLogFilterNow를 불러도 예전 레벨 기준으로 필터링되어 체크박스가 무반응처럼 보인다.
  const toggleLevel = useCallback(
    (lv) => {
      const next = { ...levelFilter, [lv]: !levelFilter[lv] }
      activeLevelsRef.current = Object.entries(next)
        .filter(([, v]) => !!v)
        .map(([k]) => k)
      setLevelFilter(next)
      reapplyLogFilterNow()
    },
    [levelFilter, reapplyLogFilterNow]
  )

  useEffect(() => {
    if (typeof getPlayTimeSec !== 'function') return
    let raf = 0
    const tick = () => {
      try {
        const t = Number(getPlayTimeSec())
        if (Number.isFinite(t)) {
          // ✅ 사용자 seek 감지(중앙화): epoch가 바뀌면 pose + overlay 캐시를 일괄 리셋한다.
          //    - pose만 리셋하면 goalPose/costmap 캐시가 남아, 시작으로 되감아도 과거 goal이
          //      nearest 픽으로 표시돼 "첫 로드와 목표 지점 유무가 다름" 불일치가 났다.
          //    - 연속 재생 중에는 epoch가 안 바뀌므로 누적/궤적이 그대로 유지된다.
          if (typeof getSeekEpoch === 'function') {
            const ep = getSeekEpoch()
            if (ep !== lastSeekEpochRef.current) {
              lastSeekEpochRef.current = ep
              // pose
              poseWindowCacheRef.current = []
              lastPoseApplyIdxRef.current = -1
              poseWindowSeqRef.current++ // 진행 중이던 이전 위치 로드는 seq 불일치로 폐기
              // overlay (costmap/path/goalPose/lidar) — 캐시/커버리지 리셋
              const ov = overlayRef.current
              for (const k of Object.keys(ov)) {
                ov[k].cache = []
                ov[k].active = { s: null, e: null }
                ov[k].lastIdx = -1
                ov[k].inflight = false
              }
              // ⚠️ 예전에는 여기서 표시(costmap/lidar/goal)를 즉시 비우지 않고 유지했다("hold-last",
              //   화면이 한 프레임 비는 깜박임을 피하려는 의도). 그런데 캐시는 "always accumulate"라
              //   seek 직후에도 옛(무관한 위치의) 프레임이 그대로 남아있어, 그 옛 내용이 새 데이터가
              //   도착하기 전까지 화면에 그대로 보였다 — "엉뚱한 위치의 예전 코스트맵/LiDAR가 잠깐
              //   보였다가 사라짐"으로 체감됨. 빈 화면 한 프레임보다 틀린 내용이 보이는 게 더 혼란스럽다는
              //   판단으로, seek 시 즉시 비우도록 바꾼다.
              setLocalCostmapData?.(null)
              setLocalCostmapFrames?.([])
              setLidarScans?.([])
              setDwaGoals?.([])
              setPlannedPathPoints?.([])
              overlayResyncPendingRef.current = true
            }
          }
          applyPoseByPlayhead(t)
          applyOverlayByPlayhead(t) // ✅ ADD
        }
      } catch {}
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPlayTimeSec, applyPoseByPlayhead, applyOverlayByPlayhead, getSeekEpoch])

  // 다운로드
  const [isPreparingDownload, setIsPreparingDownload] = useState(false)
  const handleDownloadLog = useCallback(async () => {
    if (!selectedLogId || selectedLogId === EMPTY_OPTION.id) return
    const selected = logOptions.find((l) => l.id === selectedLogId)
    if (!selected) return

    setIsPreparingDownload(true)
    const downloadUrl = await getPresignedUrl(selectedLogId)
    if (!downloadUrl) {
      setIsPreparingDownload(false)
      alert(t('logreplay.alerts.downloadUrlMissing'))
      return
    }

    const fallbackFileName = selected?.label?.replace(/\s+/g, '_') || `${selected?.id || 'log'}.mcap`

    try {
      const resp = await fetch(downloadUrl, { mode: 'cors' })
      if (!resp.ok) throw new Error(t('logreplay.alerts.downloadFailed', { status: resp.status }))

      const blob = await resp.blob()
      const cd = resp.headers.get('Content-Disposition') || resp.headers.get('content-disposition')
      const serverFileName = cd ? extractFilenameFromContentDisposition(cd) : null
      const finalFileName = serverFileName || fallbackFileName

      if (window.showSaveFilePicker) {
        try {
          setIsPreparingDownload(false)
          const pickerHandle = await window.showSaveFilePicker({
            suggestedName: finalFileName,
            types: [
              {
                description: t('logreplay.alerts.mcapFileDescription'),
                accept: { 'application/octet-stream': ['.mcap'], 'application/x-mcap': ['.mcap'] }
              }
            ]
          })
          const writable = await pickerHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          return
        } catch (pickerErr) {
          if (pickerErr && (pickerErr.name === 'AbortError' || pickerErr.name === 'NotAllowedError')) return
          console.warn('[Logreplay] 다운로드: showSaveFilePicker 실패/취소 → <a download> 폴백', pickerErr)
        }
      }

      const blobUrl = URL.createObjectURL(blob)
      setIsPreparingDownload(false)
      try {
        triggerAnchorDownload(blobUrl, finalFileName)
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
      }
    } catch (err) {
      console.warn('[Logreplay] 다운로드: fetch 실패 → 원본 URL <a download>로 폴백', err)
      setIsPreparingDownload(false)
      triggerAnchorDownload(downloadUrl, fallbackFileName, true)
    }
  }, [selectedLogId, logOptions, getPresignedUrl, t])

  // Lichtblick
  const handleOpenLichtblick = useCallback(async () => {
    if (!selectedLogId || selectedLogId === EMPTY_OPTION.id) return

    const selected = logOptions.find((l) => l.id === selectedLogId)
    if (!selected) return

    const downloadUrl = await getPresignedUrl(selectedLogId)
    if (!downloadUrl) {
      alert(t('logreplay.alerts.lichtblickUrlNotFound'))
      return
    }
    const ds = 'remote-file'
    const u = new URL(lichtblickURL)
    u.search = ''
    u.searchParams.set('ds', ds)
    u.searchParams.set('ds.url', downloadUrl)
    u.searchParams.set('embed', 'true')
    u.searchParams.set('ui', 'minimal')
    const href = u.toString()
    const popup = window.open(href, '_blank', 'noopener,noreferrer')
    if (popup) popup.opener = null
  }, [selectedLogId, logOptions, getPresignedUrl, t])

  // ──────────────────────────────────────────────────────────────
  // 조회(스트리밍)
  // ──────────────────────────────────────────────────────────────
  const handleViewLog = useCallback(async () => {
    if (!selectedLogId || selectedLogId === EMPTY_OPTION.id) return
    const selected = logOptions.find((l) => l.id === selectedLogId)
    if (!selected) return

    const filename = (selected.label ?? '').toLowerCase()
    if (!filename.includes('mcap')) {
      alert(t('logreplay.alerts.notAnalyzableFile'))
      return
    }

    const downloadUrl = await getPresignedUrl(selectedLogId)
    if (!downloadUrl) {
      alert(t('logreplay.alerts.downloadUrlMissing'))
      return
    }

    // ──────────────────────────────────────────────────────────────
    // 초기화
    // ──────────────────────────────────────────────────────────────

    const resetStreamRefs = () => {
      expectedDurationSecRef.current = 0
      decodedSpanSecRef.current = 0
      t0RawRef.current = null
      tLastRawRef.current = -Infinity
      gridDoneRef.current = false
    }

    const resetUiState = () => {
      _setLoadPhase('loading')
      updateBuffer?.(0.06)
      setPathPoints?.([])
      setGridData?.(null)
      setLocalCostmapData?.(null)
      setLocalCostmapFrames?.([])
      setPlannedPathPoints?.([])
      setFullTrajectoryPoints?.([])
      setOdomRawPoints?.([])
      setLidarScans?.([])
      setDwaGoals?.([])
      setLogLines([])
      setFilteredLines([])
      // ✅ [ADD] 센서차트 초기화
      setOdomChart1(null)
      setOdomChart2(null)
      // ✅ 조회 시작~첫 차트 데이터까지 로딩 상태 유지 → loadPhase=ready 직후 "빈 차트 박스"가 잠깐 보이는 현상 방지
      setChartLoading(true)
      searchClear?.()
      logSeqRef.current = 0
      setIsLoadingLogs(true)
      setLogError(null)
      setT0EpochMs?.(null)
      setDurationMs?.(0) // ✅ ADD
      t0EpochMsRef.current = null
      t0RawRef.current = null
      resetView?.()
      renderNow?.()
    }

    resetStreamRefs()
    resetUiState()

    // ✅ [ADD] 현재 로드 중인 파일 URL 저장(슬라이딩 window에서 사용)
    currentMcapUrlRef.current = downloadUrl
    activePoseWindowRef.current = { startSec: null, endSec: null }
    poseInflightRef.current = false
    poseTopicUnavailableRef.current = false
    gridOversizedRef.current = false
    setPoseUnavailable(false)
    setGridUnavailable(false)
    setGridOversized(false)
    poseWindowSeqRef.current = 0
    poseWindowCacheRef.current = []
    lastPoseApplyIdxRef.current = -1
    lastPollCenterRef.current = null

    // ✅ [ADD] log window reset
    activeLogWindowRef.current = { startSec: null, endSec: null }
    logWindowSeqRef.current = 0
    logWindowCacheRef.current = []
    lastLogApplyIdxRef.current = -1
    logWindowInflightRef.current = false

    // ✅ [ADD] 누적 모드 리셋
    logAccModeRef.current = 'seek'
    accStartSecRef.current = 0
    accEndCoveredRef.current = 0
    // ── overlay window reset ──
    const ov = overlayRef.current
    for (const key of Object.keys(ov)) {
      ov[key].seq = 0
      ov[key].cache = []
      ov[key].active = { s: null, e: null }
      ov[key].lastIdx = -1
      ov[key].inflight = false
    }
    // [Step1] tar.gz 사전 로드 (병렬 시작: await 하지 않음)
    // tar.gz 프리패치(비동기)
    //void prefetchTarGzForSelected(selected, logOptions, 'view-start')

    const maybeSetReady = () => {
      if (gridDoneRef.current) {
        _setLoadPhase('ready')
        updateBuffer?.(1.0)
      }
    }

    // ✅ [REPLACE] playhead 중심으로 pose window 다시 읽기 (Foxglove 방식)
    // - mcapLoader.loadPosesFromMcapUrl()가 이미 playback-relative tSec(0~)를 반환하므로
    //   pushBatchNormalized(절대 epoch 가정)를 타면 timebase가 2번 보정되어 tSec가 깨진다.
    // - 따라서 window pose는 "그대로" 정규화(sort/dedupe)해서 cache & path에 반영한다.

    const requestPoseWindow = async (centerSec, reason = 'unknown') => {
      const url = currentMcapUrlRef.current
      if (!url) return

      // ✅ 이 mcap엔 pose 토픽이 없음(또는 메시지 0개)이 이미 확정됨 — 더 이상 요청하지 않음
      //    (파일 전체 요약 통계 기준 판정이라 재생 위치와 무관하게 항상 유효하다)
      if (poseTopicUnavailableRef.current) return
      // ✅ grid가 크기 제한 초과로 폐기됨 — 그 위에 그릴 배경 자체가 없으므로 경로선/costmap/path/goal도 요청 중단
      if (gridOversizedRef.current) return

      const exp = Number(expectedDurationSecRef.current) || 0
      if (!Number.isFinite(centerSec)) return

      // ✅ 초기 로딩은 작은 윈도우(±3s)로 빠르게 표시, 이후 ±12s
      const HALF = reason === 'grid-ready' ? 3 : reason === 'seek' ? 2 : 12
      // ✅ pose 캐시는 "항상 누적"한다("지나온 경로" 보존). 과거엔 logAccModeRef(로그 전용 ref)에
      //    묶여 있었는데, 재생 중 이 값이 seek/accumulate로 flip되면서 로드 완료 시점에 seek이면
      //    캐시를 통째로 REPLACE해 궤적이 사라졌다(정지 시 특히 두드러짐). flippy 신호에서 분리.
      const startSec = Math.max(0, centerSec - HALF)
      const endSec = exp > 0 ? Math.min(exp, centerSec + HALF) : centerSec + HALF

      // timebase 준비 전 스킵(기존 로직 유지)
      const baseMs = t0EpochMsRef.current
      if (!(Number.isFinite(baseMs) && baseMs > 0)) {
        return
      }

      // ✅ in-flight 가드: pose 로드는 한 번에 하나만.
      //   ⚠️ 과거 버그: activePoseWindowRef "예약 구간"으로 스킵했는데, 로드가 seq 불일치로
      //      폐기되거나 느려도 예약 구간이 롤백되지 않아 영구 커버리지 홀이 생기고 로봇이 고정됐다.
      //      in-flight 플래그는 finally에서 반드시 해제되므로 홀이 생기지 않는다.
      // ✅ latest-wins: 로드 중이면 버리지 않고 "최신 요청 하나"로 갈아끼운다.
      //    드래그처럼 초당 수십 개가 쏟아져도 마지막 위치는 반드시 실행된다.
      if (poseInflightRef.current) {
        pendingPoseReqRef.current = { centerSec, reason }
        return
      }

      // ✅ 누적 모드: pose "자체 캐시"가 이미 center를 충분히 덮으면 skip
      //   ⚠️ 과거 버그: log window 전용 accEndCoveredRef를 참조해 pose 요청이 막혀
      //      재생 중 로봇 위치가 초기 윈도우(~12s)에 고정되던 문제 → pose 캐시 range 기준으로 수정.
      //
      // ⚠️ 새로 발견된 버그: 이 스킵은 "pose가 덮여 있는가"만 본다. 그런데 costmap/lidar/goal/path는
      //   pose와 별개로 이 fetch에 "편승"해서만 들어온다(onExtraMessage). seek 시 overlay 캐시는
      //   비우지만 pose 캐시는 (이 드래그/재생에서 이미 지나간 구간이라) 곧바로 다시 채워질 수 있어,
      //   pose 기준으로는 "이미 커버됨"이라 이 함수가 여기서 return해버리고 overlay는 영원히
      //   다시 채워지지 않는다 — "드래그 시작점 근처의 옛 코스트맵/LiDAR만 보이고, 실제 놓은 위치의
      //   새 코스트맵/LiDAR는 안 보이는" 증상의 실제 원인. overlay도 충분히 덮여 있을 때만 스킵한다.
      const pc = poseWindowCacheRef.current
      const maxCachedT = Array.isArray(pc) && pc.length ? Number(pc[pc.length - 1]?.tSec) : NaN
      const poseCovers = Number.isFinite(maxCachedT) && centerSec <= maxCachedT - 2

      // ⚠️ "배열의 마지막 요소"가 아니라 "centerSec에 실제로 가장 가까운 요소"를 봐야 한다.
      //   cache는 tSec 오름차순으로 정렬되므로, 훨씬 나중 시각(예: 드래그 중 지나간 다른 위치)의
      //   부스러기가 남아있으면 배열의 "마지막"은 항상 그 나중 시각이 된다 — centerSec과 무관하게.
      //   nearest 검색(bsearchClosest)으로 실제 근접 여부를 판단해야 정확하다.
      const isOverlayCovered = (state) => {
        const arr = state?.cache
        if (!Array.isArray(arr) || arr.length === 0) return false
        const idx = bsearchClosest(arr, centerSec)
        const nearestT = arr[idx]?.tSec
        return Number.isFinite(nearestT) && Math.abs(centerSec - nearestT) <= HALF
      }
      const ovForCheck = overlayRef.current
      const overlayCovers = isOverlayCovered(ovForCheck.costmap) && isOverlayCovered(ovForCheck.lidar)

      if (poseCovers && overlayCovers) {
        return
      }

      activePoseWindowRef.current = { startSec, endSec }
      poseInflightRef.current = true

      const seq = ++poseWindowSeqRef.current

      try {
        // 편승으로 같이 받아온 overlay를 임시로 모았다가, 최신 요청일 때만 캐시에 반영
        const extraTmp = { costmap: [], path: [], goal: [], odomRaw: [], lidar: [] }
        const raw = await loadPosesFromMcapUrl(url, {
          startSec,
          endSec,
          fullScan: true,
          previewLimit: Infinity,
          maxMillis: Infinity,
          downsample: 1,
          timeDownsampleMs: 50,
          extraTopics: MAP_EXTRA_TOPICS,
          onExtraMessage: (kind, rec) => {
            if (extraTmp[kind]) extraTmp[kind].push(rec)
          }
        })

        if (!currentMcapUrlRef.current) return

        // ✅ raw === null → "이 파일엔 pose 토픽이 없다(또는 메시지 0개)"가 확정된 것(mcapLoader.js).
        //    시간창과 무관한 파일 전체 판정이므로, 이후 requestPoseWindow 호출 자체를 영구 차단한다.
        if (raw === null) {
          poseTopicUnavailableRef.current = true
          setPoseUnavailable(true)
          return
        }

        // ✅ raw는 이미 playback-relative tSec이므로 그대로 정규화
        let norm = []
        if (Array.isArray(raw)) {
          for (const r of raw) {
            const t = Number(r?.tSec)
            const x = Number(r?.x)
            const y = Number(r?.y)
            const yaw = Number(r?.yaw) || 0
            if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue
            norm.push({ tSec: t, x, y, yaw })
          }
        }

        // 정렬 + 동일 tSec dedupe(마지막 우선)
        norm.sort((a, b) => a.tSec - b.tSec)
        norm = dedupeSortedByTSec(norm)

        // 최소 2점 보장(Player2D 가드 대응)
        if (norm.length === 1) {
          const p = norm[0]
          norm = [p, { ...p, tSec: p.tSec + 1e-6 }]
        }

        // 최신 요청만 반영
        if (seq !== poseWindowSeqRef.current) {
          return
        }

        // ✅ cache + 화면 반영

        // ✅ 항상 누적 + 메모리 상한(오래된 앞부분부터 잘라 무한 성장 방지)
        {
          const merged = poseWindowCacheRef.current.concat(norm)
          merged.sort((a, b) => a.tSec - b.tSec)
          let deduped = dedupeSortedByTSec(merged)
          const POSE_CACHE_MAX = 20000
          if (deduped.length > POSE_CACHE_MAX) deduped = deduped.slice(deduped.length - POSE_CACHE_MAX)
          poseWindowCacheRef.current = deduped
        }

        // ▼ 편승으로 받은 overlay(costmap/path/goal)를 각 캐시에 누적(+상한). 캐시 구조는 기존과 동일.
        {
          const ov = overlayRef.current
          const mergeOverlay = (state, arr, cap) => {
            if (!state || !arr || !arr.length) return
            const merged = state.cache.concat(arr)
            merged.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0))
            let d = dedupeSortedByTSec(merged)
            if (d.length > cap) d = d.slice(d.length - cap)
            state.cache = d
            state.lastIdx = -1
          }
          // costmap grid는 무거우므로 상한을 낮게(현재 프레임만 표시 → 긴 히스토리 불필요).
          // path/goal은 가벼워 여유 있게. seek 시 어차피 전체 리셋된다.
          mergeOverlay(ov.costmap, extraTmp.costmap, 400)
          mergeOverlay(ov.path, extraTmp.path, 800)
          mergeOverlay(ov.goalPose, extraTmp.goal, 800)
          // ✅ odom→map 보정용 raw odom 시계열. 재생 위치 선택 없이 전체 caches를 그대로 넘긴다(render2d가 직접 탐색).
          mergeOverlay(ov.odomRaw, extraTmp.odomRaw, 4000)
          if (extraTmp.odomRaw.length) setOdomRawPoints?.(ov.odomRaw.cache)
          // 스캔은 costmap처럼 "현재 1개"만 표시하므로 히스토리 상한은 낮게 유지.
          mergeOverlay(ov.lidar, extraTmp.lidar, 400)

          // ✅ seek 직후 첫 리로드: 새 위치에 데이터가 없는 overlay만 표시를 비운다(잔상 방지).
          //    데이터가 있으면 applyOverlayByPlayhead가 다음 프레임에 자연스럽게 교체 → 깜박임 없음.
          if (overlayResyncPendingRef.current) {
            overlayResyncPendingRef.current = false
            if (poseWindowCacheRef.current.length === 0) setPathPoints?.([])
            if (ov.costmap.cache.length === 0) {
              setLocalCostmapData?.(null)
              setLocalCostmapFrames?.([])
            }
            if (ov.path.cache.length === 0) setPlannedPathPoints?.([])
            if (ov.goalPose.cache.length === 0) setDwaGoals?.([])
            if (ov.odomRaw.cache.length === 0) setOdomRawPoints?.([])
            if (ov.lidar.cache.length === 0) setLidarScans?.([])
          }
        }

        lastPoseApplyIdxRef.current = -1

        // ✅ 경로는 applyPoseByPlayhead가 "누적 캐시" 기준 slice(0..playhead)로 설정한다.
        //    (과거: 여기서 setPathPoints(norm)으로 방금 로드한 window만 넣어, 빠른 재생 시
        //     playhead가 window를 앞지르면 "지나온 경로"가 reset되어 보이던 문제)
        // 현재 playhead에 즉시 적용(로봇 위치 + 누적 경로 갱신)
        let nowT = centerSec
        try {
          if (typeof getPlayTimeSec === 'function') {
            const v = Number(getPlayTimeSec())
            if (Number.isFinite(v)) nowT = v
          }
        } catch {}
        applyPoseByPlayhead(nowT)
      } catch (e) {
        console.warn('[Logreplay] pose 윈도우 로드 실패:', e)
      } finally {
        poseInflightRef.current = false
        // ✅ latest-wins: 대기 중인 최신 요청이 있으면 이어서 실행한다.
        //    setTimeout(0)으로 넘겨 콜스택이 쌓이지 않게 하고, 그 사이 메인스레드에 양보한다.
        const next = pendingPoseReqRef.current
        if (next) {
          pendingPoseReqRef.current = null
          setTimeout(() => {
            requestPoseWindowRef.current?.(next.centerSec, next.reason)
          }, 0)
        }
      }
    }

    // 외부(useEffect)에서 호출할 수 있도록 ref로 연결
    requestPoseWindowRef.current = requestPoseWindow
    // ✅ [ADD] rosout window 로딩 (pose와 동일 패턴)
    const requestLogWindow = async (centerSec, reason = 'unknown') => {
      const url = currentMcapUrlRef.current
      if (!url) return

      const exp = Number(expectedDurationSecRef.current) || 0
      if (!Number.isFinite(centerSec)) return

      const HALF = reason === 'grid-ready' ? 3 : reason === 'seek' ? 2 : 12
      const isAcc = logAccModeRef.current === 'accumulate'

      const startSec = isAcc && accEndCoveredRef.current > 0 ? accEndCoveredRef.current : Math.max(0, centerSec - HALF)

      const endSec = exp > 0 ? Math.min(exp, centerSec + HALF) : centerSec + HALF

      // ✅ 누적이 꼬여서 startSec가 endSec 이상이 되면 무의미한 요청이므로 스킵
      if (Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= endSec - 1e-6) {
        return
      }

      // timebase 준비 전 스킵
      const baseMs = t0EpochMsRef.current
      if (!(Number.isFinite(baseMs) && baseMs > 0)) {
        return
      }

      // 이미 커버 중이면 skip

      const cache = logWindowCacheRef.current
      if (Array.isArray(cache) && cache.length > 0) {
        const first = Number(cache[0]?.tSec)
        const last = Number(cache[cache.length - 1]?.tSec)

        if (Number.isFinite(first) && Number.isFinite(last) && centerSec >= first && centerSec <= last) {
          return
        }
      }

      // ✅ in-flight 가드: 이미 로드 중이면 skip(동시 다발 방지 → pose 로더 starvation 방지)
      if (logWindowInflightRef.current) return

      activeLogWindowRef.current = { startSec, endSec }
      const seq = ++logWindowSeqRef.current

      logWindowInflightRef.current = true
      setIsLoadingLogs(true)
      try {
        const res = await loadRosoutFromMcapUrl(url, {
          startSec,
          endSec,
          maxLines: 50000,
          batchSize: 500,
          timeDownsampleMs: 0,
          onBatch: (batch) => {
            // ✅ 검색 인덱싱이 필요하면 유지(원치 않으면 이 블록 제거 가능)
            try {
              searchAddRef.current?.(
                batch.map((e) => ({
                  ts: logSeqRef.current++,
                  level: e.level,
                  text: e.text,
                  pbMs: Math.round(e.tSec * 1000)
                }))
              )
            } catch {}
          }
        })

        if (!currentMcapUrlRef.current) return // ✅ reset 이후 응답 무시

        // 최신 요청만 반영
        if (seq !== logWindowSeqRef.current) return

        if (!res?.found) {
          if (isAcc) {
            accEndCoveredRef.current = endSec // 빈 구간도 커버 마킹
          } else {
            logWindowCacheRef.current = []
            setLogLines([])
            setFilteredLines([t('logreplay.logs.empty')])
          }

          return
        }

        let norm = Array.isArray(res.entries) ? res.entries : []

        norm.sort((a, b) => a.tSec - b.tSec)
        norm = dedupeSortedLogEntries(norm)

        if (isAcc) {
          // 누적: 기존 캐시에 append → sort → dedupe
          const merged = logWindowCacheRef.current.concat(norm)
          merged.sort((a, b) => a.tSec - b.tSec)
          logWindowCacheRef.current = dedupeSortedLogEntries(merged)
          accEndCoveredRef.current = endSec
        } else {
          // seek: 기존 로직 (REPLACE)
          logWindowCacheRef.current = norm
        }
        lastLogApplyIdxRef.current = -1

        // 즉시 현재 시점까지 반영

        requestAnimationFrame(() => {
          applyLogsByPlayhead(centerSec)
        })
      } catch (e) {
        console.warn('[Logreplay] 로그 윈도우 로드 실패:', e)
        logWindowCacheRef.current = []
        setLogLines([])
        setFilteredLines(['표시할 로그가 없습니다.'])
      } finally {
        logWindowInflightRef.current = false
        setIsLoadingLogs(false)
      }
    }
    // 외부(polling)에서 호출할 수 있게 ref 연결
    requestLogWindowRef.current = requestLogWindow

    // ✅ Overview 차트 + 남은 경로(회색) 미리보기 (전체 범위 1회 sparse 스캔, 공용)
    // - chartOverviewStarted: onTimeBounds/그리드 완료 양쪽에서 호출될 수 있어 중복 실행 방지
    // - 남은 경로도 이 스캔 결과를 그대로 재사용한다(별도 스캔을 따로 돌리면 같은 메인스레드를
    //   두 스캔이 나눠 써서 둘 다 늦게 끝나고, 그만큼 회색 선이 늦게 나타난다).
    let chartOverviewStarted = false
    const requestChartOverview = async () => {
      const url = currentMcapUrlRef.current
      if (!url) return
      if (chartOverviewStarted) return
      chartOverviewStarted = true
      setChartLoading(true)
      // ✅ 첫 배치가 도착하면 즉시 로딩 해제 → 부분 차트라도 바로 표시(점진 누적)
      let firstBatch = true
      try {
        await loadPosesSparseFromMcapUrl(url, {
          // numSamples = 표본 개수(= 디코드할 청크 수). 클수록 디테일↑·로드 비용↑.
          // 차트(시계열)와 지도 위 남은 경로(공간 궤적) 양쪽이 이 값을 함께 쓴다.
          //
          // ⚠️ 이 값이 곧 "남은 경로의 해상도"다. 40이면 10분 파일에서 표본 간격이 약 15초.
          //    올리면 경로가 실제 궤적에 가까워지지만 디코드할 청크가 비례해 늘어(스캔 완료 지연 +
          //    동시 range 요청 증가) 스캔 자체가 실패할 확률도 커진다. 40에서 완료 약 16초로 측정됨.
          //    ※ 해상도를 올리기 전에, 스캔이 끝까지 안정적으로 완료되는지부터 확인할 것.
          // ※ 이 로드는 맵 표시 이후 백그라운드에서 점진적으로(파이프라인+양보) 진행되어 맵/재생을 막지 않는다.
          numSamples: 40,
          onBatch: (posesSoFar) => {
            if (!currentMcapUrlRef.current) return
            const { c1, c2 } = buildOdomChartsFromPoses(posesSoFar)
            setOdomChart1(c1)
            setOdomChart2(c2)
            setFullTrajectoryPoints?.(posesSoFar)
            if (firstBatch) {
              firstBatch = false
              setChartLoading(false)
            }
          }
        })
      } catch (e) {
        console.warn('[Logreplay] 차트 overview 로드 실패:', e)
      } finally {
        setChartLoading(false)
      }
    }
    requestChartOverviewRef.current = requestChartOverview

    try {
      const gridPromise = (async () => {
        return await loadOccupancyGridFromMcapUrl(downloadUrl, {
          topic: TOPICS.grid,

          onTimeBounds: ({ startSec, durationSec }) => {
            // ✅ 플레이바 절대 기준
            if (t0EpochMsRef.current == null && Number.isFinite(startSec)) {
              const baseMs = Math.round(startSec * 1000)
              t0EpochMsRef.current = baseMs
              setT0EpochMs?.(baseMs)

              // ✅ grid 로더 내부에서 reader.readMessages()와 경쟁하지 않도록
              //    최초 pose window 요청은 gridPromise.then()에서 수행
              timebaseReadyRef.current = true

              // ⚠️ 차트 overview를 여기서 병렬 시작하면 pose/log/overlay 로더와
              //    메인스레드(동기 zstd 압축해제)를 두고 경쟁해 오히려 둘 다 느려진다.
              //    → 차트는 gridPromise.then()에서 critical 로더 이후에 시작한다.
            }

            // ✅ 전체 길이
            if (Number.isFinite(durationSec) && durationSec > 0) {
              expectedDurationSecRef.current = durationSec
              setDurationMs?.(Math.round(durationSec * 1000))
            }
          },

          // ✅ grid 메시지는 있었지만 전부 크기 제한 초과로 폐기된 경우: "이 로그엔 지도가 없음"과 구분해 안내
          onOversized: () => {
            gridOversizedRef.current = true
            setGridOversized(true)
          }
        })
      })()
        .then((grid) => {
          if (grid) {
            setGridData?.(grid)
          } else {
            // ✅ readMessages가 정상 종료됐는데도 유효 grid가 없음 = 이 로그엔 grid 토픽/데이터가 없다(확정)
            setGridUnavailable(true)
          }

          renderNow?.()
          gridDoneRef.current = true

          // ✅ grid가 끝난 뒤(=readMessages 종료 후) 최초 0초 pose window 요청

          if (timebaseReadyRef.current) {
            timebaseReadyRef.current = false

            setTimeout(async () => {
              // 1) 재생/표시에 즉시 필요한 critical 로더 먼저 (pose window는 단독 await)
              //    overlay(costmap/path/goal)는 pose 편승으로 함께 로드됨 → 별도 요청 불필요.
              await requestPoseWindowRef.current?.(0, 'grid-ready')
              requestLogWindowRef.current?.(0, 'grid-ready')
              // 2) 차트/남은경로 overview는 마지막에 시작(critical 로더와 메인스레드 경쟁 최소화)
              requestChartOverviewRef.current?.()
            }, 0)
          }

          maybeSetReady()
          return grid
        })
        .catch((e) => {
          console.warn('[Logreplay] grid 로드 실패:', e)
          gridDoneRef.current = true
          setGridUnavailable(true)
          setIsLoadingLogs(false)
          // grid 실패 시엔 차트 overview가 호출되지 않으므로 로딩 상태를 직접 해제
          setChartLoading(false)
          _setLoadPhase('ready')
          updateBuffer?.(1.0)

          maybeSetReady()
          return null
        })
    } catch (err) {
      console.error('[Logreplay] 로그 뷰 로드 실패:', err)
      setLogError(err?.message || String(err))
      _setLoadPhase('error')
    } finally {
    }
  }, [
    selectedLogId,
    logOptions,
    getPresignedUrl,
    setPathPoints,
    setGridData,
    setLocalCostmapData,
    setLocalCostmapFrames,
    setPlannedPathPoints,
    setFullTrajectoryPoints,
    setOdomRawPoints,
    setLidarScans,
    setDwaGoals,
    setT0EpochMs,
    resetView,
    renderNow,
    updateBuffer,
    buildOdomChartsFromPoses,
    t,
    setDurationMs,
    searchClear,
    getPlayTimeSec,
    applyPoseByPlayhead,
    applyLogsByPlayhead
  ])

  const formatDate = useCallback(function (yyyyMMdd) {
    if (!yyyyMMdd) return ''
    const [y, m, d] = yyyyMMdd.split('-')
    return `${y}.${m}.${d}`
  }, [])

  return {
    // 서버/옵션
    logOptions,
    selectedDate,
    selectedLogId,
    onDateChange,
    onLogChange,
    handleFetchListClick,
    handleVisibleRangeChange,
    allowedDateKeys,

    // 검색/로그
    logLines,
    filteredLines,
    isLoadingLogs,
    hasAnyTarLogs,
    isLoadingTar,
    tarError,
    logError,
    levelFilter,
    setLevelFilter,
    toggleLevel,
    pendingKeyword,
    setPendingKeyword,
    appliedKeyword,
    handleKeywordSearchClick,

    // 다운로드/외부 오픈
    isPreparingDownload,
    handleDownloadLog,
    handleOpenLichtblick,

    // 오버레이
    loadPhase,
    rightOverlayVisible,
    rightOverlayText,

    // 유틸
    formatDate,

    // 조회
    handleViewLog,
    queryWindow,

    odomChart1,
    odomChart2,
    chartLoading,

    // ✅ [ADD] "이 로그엔 데이터가 없다"가 확정된 상태(로딩 중과 구분)
    poseUnavailable,
    gridUnavailable,
    gridOversized,

    clearReplaySession
  }
}
