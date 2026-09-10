// hooks/useLogReplayPlayer2D.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeFit, applyZoomAtPointer, pixelsToWorldDelta, SmoothViewController } from '../view2d.js'
import { createCanvasRenderer } from '../mcap/render2d.js'
import { useThreeRobot } from '../logReplayRender.js'

/**
 * 2D 플레이어 + 뷰/렌더/캔버스 제어 + 3D 싱크
 * - 입력: pathPoints, plannedPathPoints, gridData, loadPhase, t0EpochMs
 * - 출력: 재생/스크럽/뷰 핸들러, 시간/버퍼/진행, 캔버스/프로그레스바 ref, 3D refs 등
 */
export default function useLogReplayPlayer2D({
  pathPoints,
  plannedPathPoints,
  fullTrajectoryPoints,
  odomRawPoints,
  gridData,
  localCostmapData,
  localCostmapFrames,
  lidarScans,
  dwaGoals,
  renderOptions, //    { showPath, showVelocityVector, showObstacles, showSensorPoints }
  loadPhase,
  t0EpochMs,
  durationMs: timelineDurationMs // ✅ statistics 기반 dur
}) {
  // 캔버스
  const canvasRef = useRef(null)
  const timelineMs = Math.max(0, Number(timelineDurationMs) || 0)
  // refs 동기화 (렌더러는 ref를 본다)
  const pathPointsRef = useRef([])
  const plannedPathPointsRef = useRef([])
  const fullTrajectoryPointsRef = useRef([])
  const odomRawPointsRef = useRef([])
  const gridDataRef = useRef(null)
  const localCostmapDataRef = useRef(null)
  const lidarScansRef = useRef([])
  const dwaGoalsRef = useRef([])
  const playTimeSecRef = useRef(0)
  const [playTimeSec, setPlayTimeSec] = useState(0)
  // ✅ 사용자 seek 신호(에폭). 진행바 드래그/프레임 스텝/재시작에서만 증가한다(재생 전진 시 불변).
  //   ⚠️ createCanvasRenderer 호출(아래)보다 먼저 선언해야 한다(TDZ) — index.jsx에서 겪은 것과 같은 함정.
  //   render2d가 이 값의 변화를 감지해 "정밀 지나온 경로" 누적을 리셋한다(seek만 해도 경로가
  //   보이던 문제의 근본 수정: 데이터 캐시는 항상 누적되지만, 화면에 보여줄 "지나온 경로"는
  //   실제로 재생하며 지나간 구간만이어야 한다).
  const seekEpochRef = useRef(0)
  // ✅ 진행바 fill 시작점(초). seek/step 시 동기적으로 현재 위치로 리셋 → 잔상/누적 방지.
  //    재생 중에는 그대로 두어 fill이 이 지점부터 자라난다.
  const [fillStartSec, setFillStartSec] = useState(0)
  const fillStartSecRef = useRef(0)
  const isStreamingRef = useRef(false)

  // ✅ render2d가 직접 읽는 옵션 ref
  const renderOptionsRef = useRef({
    showTrajectory: true,
    showPlannedPath: false,
    showCostmap: false,
    showGoalAndHeading: false,
    showLidar: true
  })

  // ✅ renderOptions는 부모에서 매 렌더마다 새 객체가 될 수 있으므로,
  //    "객체" 자체를 deps로 잡지 말고 primitive 필드만 추려서 동기화/리렌더 트리거를 만든다.
  const optShowTrajectory = renderOptions?.showTrajectory
  const optShowPlannedPath = renderOptions?.showPlannedPath
  const optShowCostmap = renderOptions?.showCostmap
  const optShowGoalAndHeading = renderOptions?.showGoalAndHeading
  const optShowLidar = renderOptions?.showLidar

  // Header 옵션 변경 → ref 동기화 (값 바뀔 때만)
  useEffect(() => {
    const cur = renderOptionsRef.current
    const next = {
      showTrajectory: optShowTrajectory !== false,
      showPlannedPath: optShowPlannedPath !== false,
      showCostmap: optShowCostmap !== false,
      showGoalAndHeading: optShowGoalAndHeading !== false,
      showLidar: optShowLidar !== false
    }
    // 값 동일하면 ref 갱신 불필요
    if (
      cur.showTrajectory === next.showTrajectory &&
      cur.showPlannedPath === next.showPlannedPath &&
      cur.showCostmap === next.showCostmap &&
      cur.showGoalAndHeading === next.showGoalAndHeading &&
      cur.showLidar === next.showLidar
    )
      return
    renderOptionsRef.current = { ...cur, ...next }
  }, [optShowTrajectory, optShowPlannedPath, optShowCostmap, optShowGoalAndHeading, optShowLidar])

  // ⚠️ 렌더러는 playTimeSecRef.current를 참조한다.
  // 상태만 0으로 리셋하면 첫 렌더 프레임에서 ref가 예전 값으로 남아
  // "이미 재생된 상태(연두색)"로 보일 수 있으므로 동기화해 준다.
  // ⛔ 단, 재생 중에는 RAF 루프가 playTimeSecRef를 "소유"(전진)한다.
  //    throttle(50ms)된 state로 ref를 덮으면 RAF 전진분이 되감겨, 고배속에서
  //    재생헤드/플레이바/차트가 앞뒤로 튄다(부하 시 커밋 역전으로 state까지 역행).
  //    seek/step/reset은 각자 ref를 직접 세팅하므로 재생 중 동기화는 불필요.
  useEffect(() => {
    if (isPlayingRef.current) return
    playTimeSecRef.current = Number(playTimeSec) || 0
  }, [playTimeSec])

  useEffect(() => {
    plannedPathPointsRef.current = Array.isArray(plannedPathPoints) ? plannedPathPoints : []
  }, [plannedPathPoints])
  useEffect(() => {
    gridDataRef.current = gridData || null
  }, [gridData])
  useEffect(() => {
    localCostmapDataRef.current = localCostmapData || null
  }, [localCostmapData])
  // ★ [ADD] 코스트맵 프레임 시리즈 Ref
  const localCostmapFramesRef = useRef([])
  useEffect(() => {
    localCostmapFramesRef.current = Array.isArray(localCostmapFrames) ? localCostmapFrames : []
  }, [localCostmapFrames])
  useEffect(() => {
    lidarScansRef.current = Array.isArray(lidarScans) ? lidarScans : []
  }, [lidarScans])
  useEffect(() => {
    dwaGoalsRef.current = Array.isArray(dwaGoals) ? dwaGoals : []
  }, [dwaGoals])
  // 뷰/줌·팬
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 })
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const smoothRef = useRef(new SmoothViewController(view))

  // 상호작용 상태(스무딩 억제/렌더 충돌 방지)
  const interactingRef = useRef(null) // null | 'drag' | 'wheel'
  const wheelIdleTimerRef = useRef(0)

  const resetView = useCallback(() => {
    if (isStreamingRef.current) return
    const base = { zoom: 1, panX: 0, panY: 0 }
    smoothRef.current = new SmoothViewController(base)
    viewRef.current = base
    // ✅ 동일 값이면 state 업데이트 하지 않기(불필요 렌더 루프 방지)
    setView((prev) => {
      if (prev && prev.zoom === base.zoom && prev.panX === base.panX && prev.panY === base.panY) return prev
      return base
    })
  }, [])

  // 재생/시간
  const [isPlaying, setIsPlaying] = useState(false)
  const isPlayingRef = useRef(false)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  const [isScrubbing, setIsScrubbing] = useState(false)
  const wasPlayingRef = useRef(false)

  const [playIndex, setPlayIndex] = useState(0)
  const playIndexRef = useRef(0)
  useEffect(() => {
    playIndexRef.current = playIndex
  }, [playIndex])

  // 배속
  const [playbackRate, _setPlaybackRate] = useState(1)
  const playbackRateRef = useRef(1)
  const setPlaybackRate = useCallback((r) => {
    const v = Math.max(0.01, Math.min(10, Number(r) || 1))
    playbackRateRef.current = v
    _setPlaybackRate(v)
  }, [])

  // 버퍼바(애니메이션: target -> ratio)
  const [bufferRatio, setBufferRatio] = useState(0)
  const bufferRatioRef = useRef(0)
  const bufferTargetRef = useRef(0)

  useEffect(() => {
    bufferRatioRef.current = bufferRatio
  }, [bufferRatio])

  const loadPhaseRef = useRef(loadPhase)
  useEffect(() => {
    loadPhaseRef.current = loadPhase
  }, [loadPhase])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (loadPhaseRef.current !== 'ready') {
        raf = requestAnimationFrame(tick)
        return
      }

      const cur = bufferRatioRef.current
      const dst = bufferTargetRef.current
      const target = dst > 0.9995 ? 1 : dst
      const next = target
      const snapped = Math.abs(target - next) < 0.002 ? target : next

      if (snapped !== cur) {
        bufferRatioRef.current = snapped
        setBufferRatio(snapped)
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const updateBuffer = useCallback((v) => {
    // ✅ 부호로 모드 구분: (+)fill, (-)spot
    const num = Number(v) || 0
    const clamped = Math.max(-1, Math.min(1, num))

    bufferTargetRef.current = clamped
  }, [])

  // ✅ 로드 완료되면 버퍼를 즉시 1로 스냅 (easing 대기 없이 시각적 완충)
  useEffect(() => {
    if (loadPhase === 'ready') {
      bufferTargetRef.current = 1
      bufferRatioRef.current = 1

      // ✅ 이미 1이면 setState 생략
      setBufferRatio((prev) => (prev === 1 ? prev : 1))
    }
  }, [loadPhase])

  // 렌더러
  const renderFnRef = useRef(null)
  const renderScheduledRef = useRef(false)
  const renderNow = useCallback(() => {
    if (renderScheduledRef.current || !renderFnRef.current) return
    renderScheduledRef.current = true
    requestAnimationFrame(() => {
      renderScheduledRef.current = false
      renderFnRef.current()
    })
  }, [])
  useEffect(() => {
    pathPointsRef.current = Array.isArray(pathPoints) ? pathPoints : []
    // ✅ React 커밋 후 즉시 렌더 (초기 로드 시 로봇 표시 보장)
    renderNow()
  }, [pathPoints, renderNow])
  useEffect(() => {
    fullTrajectoryPointsRef.current = Array.isArray(fullTrajectoryPoints) ? fullTrajectoryPoints : []
    renderNow()
  }, [fullTrajectoryPoints, renderNow])
  useEffect(() => {
    odomRawPointsRef.current = Array.isArray(odomRawPoints) ? odomRawPoints : []
  }, [odomRawPoints])
  const t0EpochMsRef = useRef(null)
  useEffect(() => {
    t0EpochMsRef.current = t0EpochMs
  }, [t0EpochMs]) // ★ 상태와 ref 동기화

  // ✅ statistics 기준 시간이 들어온 순간, 플레이헤드 절대시간 확정
  useEffect(() => {
    if (typeof t0EpochMs === 'number' && Number.isFinite(t0EpochMs) && t0EpochMs > 0) {
      // playTimeSec = 0 → statStart 시각
      playTimeSecRef.current = 0
      setPlayTimeSec(0)
    }
  }, [t0EpochMs])

  const renderMap2D = useMemo(() => {
    const fn = createCanvasRenderer({
      canvasRef,
      pathPointsRef,
      plannedPathPointsRef,
      fullTrajectoryPointsRef,
      odomRawPointsRef,
      gridDataRef,
      localCostmapDataRef,
      localCostmapFramesRef,
      t0EpochMsRef,
      lidarScansRef,
      dwaGoalsRef,
      playTimeSecRef,
      playIndexRef,
      viewRef,
      smoothRef,
      renderOptionsRef,
      seekEpochRef
    })
    renderFnRef.current = fn
    return fn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 뷰 변경 시 렌더 (state 커밋이 있을 때만)
  useEffect(() => {
    renderNow()
  }, [view, renderNow])

  //표시 옵션 변경 시 즉시 반영(뷰 변경 없이도 redraw)
  useEffect(() => {
    renderNow()
  }, [optShowTrajectory, optShowPlannedPath, optShowCostmap, optShowGoalAndHeading, renderNow])

  // 부드러운 뷰 보간 루프(상호작용 중엔 step 억제)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (loadPhaseRef.current !== 'ready') {
        raf = requestAnimationFrame(tick)
        return
      }

      smoothRef.current.setTarget(viewRef.current)
      if (!interactingRef.current) {
        const changed = smoothRef.current.step(0.18)
        if (changed) renderNow()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [renderNow])

  // 캔버스 이벤트(휠/드래그)
  const pauseOnMapInteraction = useCallback(() => {
    if (isPlayingRef.current) setIsPlaying(false)
  }, [])

  const roundView = (v) => ({
    zoom: Math.round((v.zoom ?? 1) * 1e4) / 1e4,
    panX: Math.round((v.panX ?? 0) * 1e4) / 1e4,
    panY: Math.round((v.panY ?? 0) * 1e4) / 1e4
  })

  const onCanvasWheel = useCallback(
    (e) => {
      e.preventDefault()
      if (loadPhase !== 'ready') return
      const cvs = canvasRef.current
      const grid = gridDataRef.current
      const pts = pathPointsRef.current || []
      if (!cvs || !Array.isArray(pts) || pts.length < 2) return
      pauseOnMapInteraction()
      interactingRef.current = 'wheel'

      const rect = cvs.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const cssW = cvs.clientWidth | 0
      const cssH = cvs.clientHeight | 0
      const fit = computeFit(grid?.info || grid, pts, cssW, cssH, 24)

      const next = applyZoomAtPointer(viewRef.current, fit, e.deltaY, px, py, {
        minZoom: 0.2,
        maxZoom: 8, // 초고배율 성능 폭주 방지 (원하면 10 유지)
        sensitivity: 0.0015
      })
      viewRef.current = roundView(next)
      smoothRef.current.snapTo(viewRef.current) // 휠도 즉시 반영(드래그와 일관)
      renderNow()

      // 휠 종료 후 120ms 지나면 커밋 + 스무딩 재개
      if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
      wheelIdleTimerRef.current = setTimeout(() => {
        interactingRef.current = null
        if (!isStreamingRef.current) {
          setView(viewRef.current)
        }
      }, 120)
    },
    [pauseOnMapInteraction, loadPhase, renderNow]
  )

  const canvasDragRef = useRef({ dragging: false, lastX: 0, lastY: 0, fit: null })
  const onCanvasMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return
      if (loadPhase !== 'ready') return
      const cvs = canvasRef.current
      if (!cvs) return
      e.preventDefault()
      pauseOnMapInteraction()

      const grid = gridDataRef.current
      const pts = pathPointsRef.current || []
      const cssW = cvs.clientWidth | 0
      const cssH = cvs.clientHeight | 0
      const fit = computeFit(grid?.info || grid, pts, cssW, cssH, 24)
      canvasDragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY, fit }
      interactingRef.current = 'drag'

      const onMove = (ev) => {
        if (!canvasDragRef.current.dragging) return
        const dx = ev.clientX - canvasDragRef.current.lastX
        const dy = ev.clientY - canvasDragRef.current.lastY
        canvasDragRef.current.lastX = ev.clientX
        canvasDragRef.current.lastY = ev.clientY
        const { dPanX, dPanY } = pixelsToWorldDelta(viewRef.current, canvasDragRef.current.fit, dx, dy)
        viewRef.current = roundView({
          ...viewRef.current,
          panX: viewRef.current.panX + dPanX,
          panY: viewRef.current.panY + dPanY
        })
        smoothRef.current.snapTo(viewRef.current)
        renderNow()
      }
      const onUp = () => {
        canvasDragRef.current.dragging = false
        interactingRef.current = null

        if (!isStreamingRef.current) {
          setView(viewRef.current)
        }

        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [pauseOnMapInteraction, loadPhase, renderNow]
  )

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const wheelHandler = (ev) => {
      ev.preventDefault()
      onCanvasWheel(ev)
    }
    const touchMoveBlocker = (ev) => {
      ev.preventDefault()
    }
    const pointerMoveBlocker = (ev) => {
      if (canvasDragRef.current?.dragging) ev.preventDefault()
    }
    cvs.addEventListener('wheel', wheelHandler, { passive: false })
    cvs.addEventListener('touchmove', touchMoveBlocker, { passive: false })
    cvs.addEventListener('pointermove', pointerMoveBlocker, { passive: false })
    return () => {
      cvs.removeEventListener('wheel', wheelHandler)
      cvs.removeEventListener('touchmove', touchMoveBlocker)
      cvs.removeEventListener('pointermove', pointerMoveBlocker)
    }
  }, [onCanvasWheel])

  // canPlay

  const canPlay = useMemo(() => {
    if (loadPhase !== 'ready') return false
    if (timelineMs > 0) return true
    return Array.isArray(pathPoints) && pathPoints.length >= 2
  }, [loadPhase, pathPoints, timelineMs])

  const leftPlayable = useMemo(() => Array.isArray(pathPoints) && pathPoints.length >= 2, [pathPoints])
  const controlsDisabled = !canPlay

  // 진행 비율

  const playRatio = useMemo(() => {
    if (timelineMs > 0) {
      const durSec = timelineMs / 1000
      return durSec > 0 ? Math.max(0, Math.min(1, playTimeSec / durSec)) : 0
    }
    const pts = Array.isArray(pathPoints) ? pathPoints : []
    if (pts.length < 2) return 0
    const dur = Math.max(0, (pts[pts.length - 1].tSec ?? 0) - (pts[0].tSec ?? 0))
    return dur > 0 ? Math.max(0, Math.min(1, playTimeSec / dur)) : 0
  }, [pathPoints, playTimeSec, timelineMs])

  // 진행바 fill 시작 비율 (playRatio와 동일한 dur 기준)
  const playFillStartRatio = useMemo(() => {
    let dur = 0
    if (timelineMs > 0) {
      dur = timelineMs / 1000
    } else {
      const pts = Array.isArray(pathPoints) ? pathPoints : []
      if (pts.length >= 2) dur = Math.max(0, (pts[pts.length - 1].tSec ?? 0) - (pts[0].tSec ?? 0))
    }
    return dur > 0 ? Math.max(0, Math.min(1, fillStartSec / dur)) : 0
  }, [pathPoints, fillStartSec, timelineMs])

  // RAF 재생 루프
  const rafRef = useRef(0)

  // ✅ UI state 커밋 스로틀(너무 잦은 setState로 depth exceeded 방지)
  const lastUiCommitMsRef = useRef(0)

  // 외부에서 재생 관련 ref/state를 즉시 0으로 초기화하기 위한 헬퍼(파일 전환 시 호출됨)
  const resetPlaybackRefs = useCallback(() => {
    try {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    } catch {}

    // ✅ 파일 전환도 seek 신호로 취급 → render2d의 "지나온 경로(초록)" 누적 버퍼를 비운다.
    //    (안 그러면 이전 파일에서 쌓인 초록 경로가 새 파일 좌표계에 그대로 남는다)
    seekEpochRef.current++

    // ✅ 추가 (이게 핵심)
    isPlayingRef.current = false

    // 재생 중지
    isPlayingRef.current = false
    setIsPlaying(false)
    // 플레이헤드/인덱스 0으로 (ref + state 모두)
    playTimeSecRef.current = 0
    setPlayTimeSec(0)
    playIndexRef.current = 0
    setPlayIndex(0)
    // fill 시작점도 0으로
    fillStartSecRef.current = 0
    setFillStartSec(0)
  }, [])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (!isPlaying) return
    let last = performance.now()
    lastUiCommitMsRef.current = 0
    const loop = (now) => {
      if (isScrubbing) {
        last = now
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      const dtSec = Math.max(0, (now - last) / 1000) * (playbackRateRef.current || 1)
      last = now

      const pts = pathPointsRef.current
      const durationSec =
        timelineMs > 0
          ? timelineMs / 1000 // ✅ statistics 기반
          : Array.isArray(pts) && pts.length >= 2
            ? Math.max(0, pts[pts.length - 1].tSec - pts[0].tSec)
            : 0

      if (durationSec <= 0) {
        setIsPlaying(false)
        return
      }

      let nextTime = playTimeSecRef.current + dtSec
      if (nextTime >= durationSec) {
        nextTime = durationSec
        playTimeSecRef.current = nextTime
        playIndexRef.current = 499
        // ✅ 종료 시에는 반드시 최종 커밋
        setPlayTimeSec(nextTime)
        setPlayIndex(499)
        setIsPlaying(false)
        renderNow()
        return
      }

      playTimeSecRef.current = nextTime

      const ratio = durationSec > 0 ? nextTime / durationSec : 0
      const idx = Math.max(0, Math.min(499, Math.round(ratio * 499)))
      playIndexRef.current = idx

      // ✅ UI state는 너무 자주 업데이트하지 않음(예: 50ms=20Hz)
      const since = now - (lastUiCommitMsRef.current || 0)
      if (since >= 50) {
        lastUiCommitMsRef.current = now
        setPlayTimeSec(nextTime)
        setPlayIndex(idx)
      }

      renderNow()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, isScrubbing, renderNow, timelineMs])

  // 스크럽(플레이바 드래그) — 실시간 렌더 보장
  const progressBarRef = useRef(null)

  // ✅ 드래그 중 상태 커밋은 "프레임당 1회"로 접는다.
  //   원인: 메인스레드가 길게 막히면(개발 빌드에서 수 초 관측) 그동안 pointermove가 큐에 쌓이고,
  //   막힘이 풀릴 때 수십 건이 한 태스크에서 몰려 처리된다. 각 건이 setState를 3번씩 하므로
  //   React가 "Maximum update depth exceeded"를 던졌다.
  //   화면은 ref(playTimeSecRef) + renderNow()로 그리므로, 상태 커밋을 늦춰도 체감 반응성은 그대로다.
  //
  // ⚠️ 커밋 스케줄링에 requestAnimationFrame을 쓰면 안 된다(2026-09-08 확인):
  //    rAF 콜백에서 낸 업데이트는 React의 중첩 업데이트 카운터를 초기화하지 못해
  //    드래그를 오래 하면 "Maximum update depth exceeded"가 발생했다.
  //    setTimeout(매크로태스크)은 태스크 경계를 만들어 카운터가 초기화된다.
  //    주기는 이 파일의 재생 루프와 동일하게 20Hz(50ms)로 맞춘다.
  const SCRUB_COMMIT_MS = 50
  const scrubCommitTimerRef = useRef(0)
  const scrubPendingRef = useRef(null)
  const scrubLastCommitMsRef = useRef(0)

  const commitScrubState = useCallback(() => {
    scrubCommitTimerRef.current = 0
    const p = scrubPendingRef.current
    scrubPendingRef.current = null
    if (!p) return

    setPlayTimeSec(p.timeSec)
    if (p.emitIndex) setPlayIndex(p.idx)
    setFillStartSec(p.timeSec)
    scrubLastCommitMsRef.current = performance.now()
  }, [])

  // 언마운트 시 대기 중인 커밋 취소(언마운트 후 setState 경고 방지)
  useEffect(() => {
    return () => {
      if (scrubCommitTimerRef.current) clearTimeout(scrubCommitTimerRef.current)
      scrubCommitTimerRef.current = 0
      scrubPendingRef.current = null
    }
  }, [])

  const setPlayHeadByRatio = useCallback(
    (r, { emitIndex = true } = {}) => {
      const dur =
        Number.isFinite(durationMs) && durationMs > 0
          ? durationMs / 1000
          : (() => {
              const pts = pathPointsRef.current
              if (!pts || pts.length < 2) return 0
              return pts[pts.length - 1].tSec - pts[0].tSec
            })()

      if (dur <= 0) return

      const nextTime = Math.max(0, Math.min(dur, r * dur))

      // ref는 즉시 갱신(렌더러가 읽는 값) — 반응성은 여기서 보장된다.
      playTimeSecRef.current = nextTime
      const idx = Math.max(0, Math.min(499, Math.round((dur > 0 ? nextTime / dur : 0) * 499)))
      if (emitIndex) playIndexRef.current = idx
      // ✅ seek 즉시 fill 시작점을 현재 위치로 리셋(동기) → 진행바 잔상/누적 제거
      fillStartSecRef.current = nextTime

      // 상태 커밋은 프레임당 1회로 접는다(이벤트 폭주 방어). 항상 "가장 최신 값"만 남긴다.
      const prev = scrubPendingRef.current
      scrubPendingRef.current = {
        timeSec: nextTime,
        idx,
        emitIndex: emitIndex || !!prev?.emitIndex
      }
      if (!scrubCommitTimerRef.current) {
        // 마지막 커밋 이후 남은 시간만큼만 기다린다(첫 이벤트는 거의 즉시 반영).
        const since = performance.now() - scrubLastCommitMsRef.current
        const delay = Math.max(0, SCRUB_COMMIT_MS - since)
        scrubCommitTimerRef.current = setTimeout(commitScrubState, delay)
      }

      renderNow() // ← 실시간 반영
    },
    [renderNow, timelineMs, commitScrubState]
  )

  const handleProgressPointerDown = useCallback(
    (e) => {
      const pts = pathPointsRef.current || []
      if (!Array.isArray(pts) || pts.length < 2) return
      const bar = progressBarRef.current
      if (!bar) return

      e.preventDefault()
      wasPlayingRef.current = isPlayingRef.current
      setIsPlaying(false)
      setIsScrubbing(true)
      seekEpochRef.current++ // 사용자 seek 시작 → 데이터 훅이 pose 캐시 리셋

      const getRatio = (clientX) => {
        const rect = bar.getBoundingClientRect()
        const r = (clientX - rect.left) / Math.max(1, rect.width)
        return Math.max(0, Math.min(1, r))
      }

      setPlayHeadByRatio(getRatio(e.clientX))

      const onMove = (ev) => setPlayHeadByRatio(getRatio(ev.clientX))
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setIsScrubbing(false)
        if (wasPlayingRef.current) setIsPlaying(true)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setPlayHeadByRatio]
  )

  // RAF 재생 루프 위쪽/아래쪽 아무 데나 보조 함수 영역에 추가
  // ▶ base step(초) at 1x — 필요시 0.5 같은 값으로 미세조정 가능합니다.
  const stepSecondsRef = useRef(1) // 1×에서 1초 이동

  // ▶ 배속을 반영해 "초 단위"로 스텝 이동
  const _stepBySeconds = useCallback(
    (dir = +1) => {
      const pts = pathPointsRef.current || []
      const dur =
        timelineMs > 0
          ? timelineMs / 1000
          : Array.isArray(pts) && pts.length >= 2
            ? Math.max(0, (Number(pts[pts.length - 1]?.tSec) || 0) - (Number(pts[0]?.tSec) || 0))
            : 0

      if (dur <= 0) return

      seekEpochRef.current++ // 프레임 이동 = seek → 데이터 훅이 pose 캐시 리셋

      const rate = Math.max(0.01, Math.min(10, Number(playbackRateRef.current) || 1))
      const baseStepSec = Number(stepSecondsRef.current) || 1
      const delta = baseStepSec * rate * (dir >= 0 ? 1 : -1)

      let nextTimeSec = (Number(playTimeSecRef.current) || 0) + delta
      nextTimeSec = Math.max(0, Math.min(dur, nextTimeSec)) // 경계 클램프

      // 시간 반영
      playTimeSecRef.current = nextTimeSec
      setPlayTimeSec(nextTimeSec)

      // 인덱스(0..499) 환산 — 기존 파이프라인과 호환 유지
      const ratio = dur > 0 ? nextTimeSec / dur : 0
      const idx = Math.max(0, Math.min(499, Math.round(ratio * 499)))
      playIndexRef.current = idx
      setPlayIndex(idx)

      // ✅ 프레임 스텝도 수동 이동(seek) → fill 시작점을 현재 위치로 리셋
      fillStartSecRef.current = nextTimeSec
      setFillStartSec(nextTimeSec)

      renderNow()
    },
    [renderNow, timelineMs]
  )

  // ▼ REPLACE: 이전 프레임(배속 반영)
  const handlePrevFrame = useCallback(() => {
    const pts = pathPointsRef.current || []
    if (!Array.isArray(pts) || pts.length < 2) return
    setIsPlaying(false)
    _stepBySeconds(-1) // ← 배속 × 1초 기준으로 한 스텝 뒤로
  }, [_stepBySeconds])

  // ▼ REPLACE: 다음 프레임(배속 반영)
  const handleNextFrame = useCallback(() => {
    const pts = pathPointsRef.current || []
    if (!Array.isArray(pts) || pts.length < 2) return
    setIsPlaying(false)
    _stepBySeconds(+1) // ← 배속 × 1초 기준으로 한 스텝 앞으로
  }, [_stepBySeconds])

  const handleTogglePlay = useCallback(() => {
    const pts = pathPointsRef.current || []
    const durationSec =
      timelineMs > 0
        ? timelineMs / 1000
        : Array.isArray(pts) && pts.length >= 2
          ? Math.max(0, (Number(pts[pts.length - 1]?.tSec) || 0) - (Number(pts[0]?.tSec) || 0))
          : 0

    const can = loadPhase === 'ready' && durationSec > 0
    if (!can) return

    setIsPlaying((p) => {
      if (!p) {
        const atEnd = typeof playIndexRef.current === 'number' && playIndexRef.current >= 499 - 0.001
        if (atEnd) {
          seekEpochRef.current++ // 끝→처음 재시작 = seek → 데이터 훅이 pose 캐시 리셋
          playTimeSecRef.current = 0
          setPlayTimeSec(0)
          playIndexRef.current = 0
          setPlayIndex(0)
          // 끝→처음 재시작 시 fill 시작점도 0으로
          fillStartSecRef.current = 0
          setFillStartSec(0)
          renderNow()
        }
      }
      return !p
    })
  }, [renderNow, loadPhase, timelineMs])

  // 시간 라벨
  const formatKST = useCallback((ms) => {
    try {
      const dt = new Date(ms)
      const parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour12: true,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      }).formatToParts(dt)
      const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
      const y = get('year'),
        m = get('month'),
        d = get('day')
      const hour = get('hour'),
        minute = get('minute'),
        second = get('second')
      const dayPeriod = get('dayPeriod')?.toUpperCase() || (dt.getHours() < 12 ? 'AM' : 'PM')
      const SSS = String(dt.getMilliseconds()).padStart(3, '0')
      return `${y}-${m}-${d} ${hour}:${minute}:${second}.${SSS} ${dayPeriod} KST`
    } catch {
      return '0000-00-00 0:00:00.000 AM KST'
    }
  }, [])

  const { durationMs, currentTimestampMs, formattedCurrentTime, formattedDuration } = useMemo(() => {
    const pts = Array.isArray(pathPoints) ? pathPoints : []
    const baseMs = Number(t0EpochMs) || 0

    const resolvedDurationMs =
      timelineMs > 0
        ? timelineMs
        : pts.length >= 2
          ? Math.round(Math.max(0, pts[pts.length - 1].tSec - pts[0].tSec || 0) * 1000)
          : 0

    // ✅ statistics(timebase)가 있으면 pathPoints 없이도 시간 표시는 가능
    if (pts.length < 2) {
      return {
        durationMs: resolvedDurationMs,
        currentTimestampMs: baseMs || 0,
        formattedCurrentTime: baseMs ? formatKST(baseMs) : '0000-00-00 0:00:00.000 AM KST',
        formattedDuration:
          baseMs && resolvedDurationMs > 0
            ? formatKST(baseMs + resolvedDurationMs)
            : baseMs
              ? formatKST(baseMs)
              : '0000-00-00 ...'
      }
    }

    const durationMs = resolvedDurationMs
    const durSec = Math.max(0, durationMs / 1000)
    const clampedTimeSec = Math.max(0, Math.min(durSec, Number(playTimeSec) || 0))

    const relativeMs = Math.round(clampedTimeSec * 1000)
    const currentTimestampMs = baseMs ? baseMs + relativeMs : 0
    const absCurrentMs = currentTimestampMs
    const absEndMs = baseMs + durationMs

    return {
      durationMs,
      currentTimestampMs,
      formattedCurrentTime: baseMs ? formatKST(absCurrentMs) : '0000-00-00 0:00:00.000 AM KST',
      formattedDuration: baseMs ? formatKST(absEndMs) : '0000-00-00 0:00:00.000 AM KST'
    }
  }, [pathPoints, playTimeSec, t0EpochMs, formatKST, timelineMs])

  // =========================
  // 진행바 Hover 시간(툴팁) 로직
  // =========================
  const [hoverVisible, setHoverVisible] = useState(false)
  const [hoverRatio, setHoverRatio] = useState(0)
  const [hoverMs, setHoverMs] = useState(0)
  const [hoverAbsLabel, setHoverAbsLabel] = useState('') // ★ 절대시간(KST)

  const getRatioFromEvent = useCallback((ev) => {
    const bar = progressBarRef.current
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    const x = Math.max(rect.left, Math.min(ev.clientX, rect.right))
    const ratio = (x - rect.left) / Math.max(1, rect.width)
    return Math.max(0, Math.min(1, ratio))
  }, [])

  const onProgressMouseEnter = useCallback(
    (ev) => {
      if (!Number.isFinite(durationMs) || durationMs <= 0) return
      const r = getRatioFromEvent(ev)
      const ms = Math.round((Number(durationMs) || 0) * r)
      setHoverRatio(r)
      setHoverMs(ms)
      // ★ 절대 시간(KST) 포맷: t0EpochMs가 있으면 절대값으로 표기
      const baseMs = Number(t0EpochMs) || 0
      if (baseMs) {
        setHoverAbsLabel(formatKST(baseMs + ms))
      } else {
        setHoverAbsLabel('') // base가 없으면 PlayerBar에서 상대 ms로 표시
      }
      setHoverVisible(true)
    },
    [durationMs, getRatioFromEvent, t0EpochMs, formatKST]
  )

  const onProgressMouseMove = useCallback(
    (ev) => {
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        if (hoverVisible) setHoverVisible(false)
        return
      }
      const r = getRatioFromEvent(ev)
      const ms = Math.round((Number(durationMs) || 0) * r)
      setHoverRatio(r)
      setHoverMs(ms)
      const baseMs = Number(t0EpochMs) || 0
      if (baseMs) {
        setHoverAbsLabel(formatKST(baseMs + ms))
      } else {
        setHoverAbsLabel('')
      }
      if (!hoverVisible) setHoverVisible(true)
    },
    [durationMs, getRatioFromEvent, hoverVisible, t0EpochMs, formatKST]
  )

  const onProgressMouseLeave = useCallback(() => {
    setHoverVisible(false)
    setHoverAbsLabel('')
  }, [])

  // 3D 싱크
  const { threeMountRef, poses3d, setPoses3d, durationSec, currentTimeSec } = useThreeRobot(playIndexRef.current)

  // ready 전환 시 한 번 센터
  const readyOnceRef = useRef(false)
  useEffect(() => {
    if (loadPhase === 'loading') {
      isStreamingRef.current = true
      readyOnceRef.current = false
      return
    }

    if (loadPhase === 'ready' && !readyOnceRef.current) {
      isStreamingRef.current = false
      readyOnceRef.current = true
      resetView() // ✅ 딱 1회
      renderNow()
    }
  }, [loadPhase, resetView, renderNow])

  return {
    // 렌더/버퍼
    canvasRef,
    renderNow,
    updateBuffer,

    // 재생/시간/프로그레스
    isPlaying,
    setIsPlaying,
    playIndex,
    setPlayIndex,
    playTimeSec,
    setPlayTimeSec,
    playbackRate,
    setPlaybackRate,
    playRatio,
    playFillStartRatio,
    bufferRatio,

    // 뷰
    view,
    setView,
    resetView,

    // 캔버스 인터랙션
    onCanvasWheel,
    onCanvasMouseDown,

    // 진행바/스크럽
    progressBarRef,
    handleProgressPointerDown,
    onProgressMouseEnter,
    onProgressMouseMove,
    onProgressMouseLeave,
    handlePrevFrame,
    handleTogglePlay,
    handleNextFrame,

    // 게이팅
    canPlay,
    leftPlayable,
    controlsDisabled,

    // 시간 라벨
    durationMs,
    currentTimestampMs,
    formattedCurrentTime,
    formattedDuration,
    // Hover 툴팁
    hoverVisible,
    hoverMs,
    hoverRatio,
    hoverAbsLabel,

    // 3D
    threeMountRef,
    poses3d,
    setPoses3d,
    durationSec,
    currentTimeSec,
    resetPlaybackRefs,
    seekEpochRef
  }
}
