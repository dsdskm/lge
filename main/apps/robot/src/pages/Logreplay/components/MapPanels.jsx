// Logreplay/components/MapPanels.jsx
import React, { memo, useMemo, useRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { S } from '../styles'
import SensorChart from './SensorChart'
import { Button } from '@repo/ui'
import DrivingMap3D from './DrivingMap3D'

// ✅ SensorChart에 넘기는 labels/colors는 정적이므로 모듈 상수로 고정.
//    (인라인 객체로 넘기면 매 렌더마다 새 참조 → SensorChart effect 재실행 → uPlot 재생성)
const VEL_LABELS = { x: 'vx', y: 'vy', z: 'speed' }
const VEL_COLORS = { x: '#ef4444', y: '#3b82f6', z: '#10b981' }
const POSE_LABELS = { x: 'x', y: 'y', z: 'yaw' }
const POSE_COLORS = { x: '#f97316', y: '#8b5cf6', z: '#111827' }

// [REPLACE] Legend 전체 함수 교체 (패널만 렌더)
const Legend = memo(function Legend({ open = true }) {
  const { t } = useTranslation('robot')
  if (!open) return null
  return (
    <div style={S.legendBox} aria-label={t('logreplay.map.legendAriaLabel')}>
      <div style={S.legendRow}>
        <span style={S.robotTriIcon()} aria-hidden />
        <span>{t('logreplay.map.robot')}</span>
      </div>
      <div style={S.legendRow}>
        <span style={S.circleSwatch('#10B981')} aria-hidden />
        <span>{t('logreplay.map.pathDone')}</span>
      </div>
      <div style={S.legendRow}>
        <span style={S.circleSwatch('#9CA3AF')} aria-hidden />
        <span>{t('logreplay.map.pathRemaining')}</span>
      </div>
      <div style={S.legendRow}>
        <span style={S.circleSwatch('#FFA500')} aria-hidden />
        <span>{t('logreplay.map.lidarPoints')}</span>
      </div>
      <div style={S.legendRow}>
        <div style={S.gradientBarMini} aria-hidden />
        <span style={{ whiteSpace: 'nowrap' }}>{t('logreplay.map.localCostmap')}</span>
      </div>
      <div style={S.legendRow}>
        <span style={S.dashedBoxSample} aria-hidden />
        <span>{t('logreplay.map.localCostmapRange')}</span>
      </div>
      <div style={S.legendRow}>
        <span style={S.goalCrossSample} aria-hidden />
        <span>{t('logreplay.map.goalPoint')}</span>
      </div>
    </div>
  )
})

const LeftMapCard = memo(function LeftMapCard({
  canvasRef,
  onCanvasMouseDown,
  loadPhase,
  leftPlayable,
  leftInteractiveReady,
  leftOverlayText,
  leftNoData,

  gridData,
  pathPoints,
  plannedPathPoints,
  fullTrajectoryPoints,
  lidarScans,
  localCostmapFrames,
  odomRawPoints,
  dwaGoals,
  currentTimestampMs,
  t0EpochMs,

  // ✅ [ADD] odom(=pose) 기반 센서 차트 데이터
  odomChart1,
  odomChart2,
  chartLoading,

  // ✅ [ADD] grid가 크기 제한 초과로 폐기된 경우 — 스피너가 아닌 확정 안내 문구로 표시(canvas는 계속 hidden)
  gridOversized
}) {
  const { t } = useTranslation('robot')
  const [legendOpen, setLegendOpen] = useState(true)
  const [is3D, setIs3D] = useState(false)
  const hasGrid = !!gridData

  // ✅ 캔버스 draw는 renderNow(rAF) 이후에 일어나므로, ready 직후 곧바로 오버레이를 내리면
  //    "그려지지 않은 빈 캔버스"가 한 프레임 노출된다. 2 프레임(rAF) 기다렸다가 공개해 깜빡임 방지.
  const [paintReady, setPaintReady] = useState(false)
  useEffect(() => {
    if (!leftInteractiveReady) {
      setPaintReady(false)
      return
    }
    let r1 = 0
    let r2 = 0
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setPaintReady(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [leftInteractiveReady])

  // 좌측 오버레이 정책: init/error는 명시적으로 오버레이,
  // 그 외엔 leftInteractiveReady + 첫 페인트 완료까지 오버레이 유지
  const showLeftOverlay = loadPhase === 'error' || loadPhase === 'init' || !leftInteractiveReady || !paintReady

  return (
    <div style={S.mapCard}>
      <div style={S.mapHeader}>
        <span>{t('logreplay.map.movementStatus')}</span>
        <div style={S.mapHeaderRight}>
          {/* ✅ 3D 모드에서도 범례 표시(2D와 동일 UX) */}
          <>
            <button
              type="button"
              onClick={() => setLegendOpen((v) => !v)}
              title={legendOpen ? t('logreplay.map.legendCollapse') : t('logreplay.map.legendExpand')}
              aria-expanded={legendOpen}
              style={S.legendHeaderToggleBtn}
            >
              {`${t('logreplay.map.legendToggle')} ${legendOpen ? '⌃' : '⌄'}`}
            </button>
            <Legend open={legendOpen} />
          </>
          <Button
            size="sm"
            theme="default"
            onClick={() => setIs3D((v) => !v)}
            title={is3D ? t('logreplay.map.switchTo2D') : t('logreplay.map.switchTo3D')}
            style={S.toggleMapBtn}
          >
            {is3D ? t('logreplay.map.mode2D') : t('logreplay.map.mode3D')}
          </Button>
        </div>
      </div>

      <div style={S.mapBody}>
        {/* ✅ 2D/3D를 언마운트하지 말고 둘 다 항상 마운트 */}
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* 2D Layer */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              visibility: 'visible',
              pointerEvents: is3D ? 'none' : 'auto'
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                ...S.mapImage,
                visibility: leftInteractiveReady || hasGrid ? 'visible' : 'hidden'
              }}
              onMouseDown={onCanvasMouseDown}
            />

            {showLeftOverlay && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  ...S.loadingOverlay,
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                {loadPhase !== 'init' && loadPhase !== 'error' && !leftNoData && !gridOversized && leftOverlayText ? (
                  <>
                    <span
                      aria-hidden
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid rgba(0,0,0,0.15)',
                        borderTopColor: '#666',
                        animation: 'map-left-spin 0.9s linear infinite'
                      }}
                    />
                    <span>{leftOverlayText}</span>
                    <style>{`@keyframes map-left-spin {from{transform:rotate(0)} to{transform:rotate(360deg)}}`}</style>
                  </>
                ) : (
                  <span>{leftOverlayText}</span>
                )}
              </div>
            )}
          </div>

          {/* 3D Layer */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              visibility: is3D ? 'visible' : 'hidden',
              pointerEvents: is3D ? 'auto' : 'none'
            }}
          >
            <DrivingMap3D
              isActive={is3D}
              gridData={gridData}
              pathPoints={pathPoints}
              plannedPathPoints={plannedPathPoints}
              fullTrajectoryPoints={fullTrajectoryPoints}
              lidarScans={lidarScans}
              localCostmapFrames={localCostmapFrames}
              odomRawPoints={odomRawPoints}
              dwaGoals={dwaGoals}
              currentTimestampMs={currentTimestampMs}
              t0EpochMs={t0EpochMs}
            />
          </div>
        </div>
      </div>
    </div>
  )
})

// ✅ 우측 헤더: 센서 정보로 고정 + 토글 제거(이동면적 disable 정책)
const RightHeader = memo(function RightHeader({ isLoadingLogs, timeLabelRef }) {
  const { t } = useTranslation('robot')
  return (
    <div style={S.mapHeader}>
      <span>{t('logreplay.map.sensorInfo')}</span>
      <div style={S.mapHeaderRight}>
        <span style={S.mapSubLabel} ref={timeLabelRef} />
        {/* 토글/버튼은 추후 필요 시 추가 */}
      </div>
    </div>
  )
})

function MapPanels({
  canvasRef,
  threeMountRef,
  isLoadingLogs,
  loadPhase,
  onCanvasMouseDown,
  msToClock,
  leftPlayable,
  coveragePathPoints = [],
  currentTimestampMs,
  durationMs,
  formattedCurrentTime,
  formattedDuration,
  // ▼ 3D용 데이터
  gridData,
  pathPoints,
  plannedPathPoints,
  fullTrajectoryPoints,
  lidarScans,
  localCostmapFrames,
  odomRawPoints,
  dwaGoals,
  t0EpochMs,

  odomChart1,
  odomChart2,
  chartLoading,

  // ✅ [ADD] "이 로그엔 데이터가 없다"가 확정된 상태(로딩 중과 구분)
  poseUnavailable,
  gridUnavailable,
  // ✅ [ADD] grid 토픽/메시지는 있었지만 크기 제한(MAX_GRID_DIMENSION/MAX_GRID_CELLS) 초과로 전부 폐기된 경우
  gridOversized
}) {
  const { t } = useTranslation('robot')
  // ===============================
  // 좌측 게이팅(기존 그대로)
  // ===============================

  // ✅ playheadSec: 차트 x축은 (tSec + t0/1000)이고 SensorChart가 다시 (playheadSec + t0/1000)로 변환하므로,
  //    여기서는 "재생 시작 기준 상대 초"(= (현재 epoch - t0)/1000)를 넘겨야 빨간 선이 정확히 맞는다.
  const playheadSec =
    typeof currentTimestampMs === 'number' &&
    currentTimestampMs > 0 &&
    typeof t0EpochMs === 'number' &&
    Number.isFinite(t0EpochMs)
      ? (currentTimestampMs - t0EpochMs) / 1000
      : null

  // ✅ 두 센서 차트가 동일한 x축(전체 주행 구간, 절대 초)을 쓰도록 고정
  //    → 차트별 데이터 범위 차이로 재생 커서가 한쪽에만 보이던 문제 해결
  const chartXRange = useMemo(() => {
    if (
      typeof t0EpochMs === 'number' &&
      Number.isFinite(t0EpochMs) &&
      typeof durationMs === 'number' &&
      durationMs > 0
    ) {
      const s0 = t0EpochMs / 1000
      return [s0, s0 + durationMs / 1000]
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0EpochMs, durationMs])

  const LEFT_MIN_SAMPLES = 150
  const LEFT_MIN_SECONDS = 3.0

  const leftHasPts = Array.isArray(coveragePathPoints) && coveragePathPoints.length >= 2
  const leftDurSec = useMemo(() => {
    if (!leftHasPts) return 0
    const t0 = Number(coveragePathPoints[0]?.tSec) || 0
    const t1 = Number(coveragePathPoints[coveragePathPoints.length - 1]?.tSec) || 0
    return Math.max(0, t1 - t0)
  }, [leftHasPts, coveragePathPoints])

  const leftReadyByData = useMemo(() => {
    if (!leftHasPts) return false
    const sampleOK = coveragePathPoints.length >= LEFT_MIN_SAMPLES
    const timeOK = leftDurSec >= LEFT_MIN_SECONDS
    return sampleOK || timeOK
  }, [leftHasPts, coveragePathPoints.length, leftDurSec])

  // ✅ Step1: grid만 있어도 2D 캔버스는 보여야 한다(경로 수집 전이라도)
  const leftHasGrid = !!gridData

  // ✅ 로그 로딩과 지도/플레이는 분리: 지도는 ready면 인터랙션 허용
  //    ⚠️ grid가 크기 제한 초과로 폐기된 경우는 "데이터가 없을 뿐"이 아니라 방어 코드가 명시적으로
  //       거부한 것이므로, pose가 있어도 캔버스에 아무것도 그리지 않고 안내 문구만 계속 표시한다.
  const leftInteractiveReady = loadPhase === 'ready' && !gridOversized && (leftReadyByData || leftHasGrid)

  // ✅ grid/pose 각각 "이 로그엔 없음"이 확정된 경우 — 계속 기다리는 스피너 대신 안내 문구로 전환
  //    두 원인을 구분해야 사용자가 어느 토픽을 봐야 할지 알 수 있으므로 따로 판정한다.
  const leftGridNoData = loadPhase === 'ready' && !!gridUnavailable
  const leftPoseNoData = loadPhase === 'ready' && !!poseUnavailable
  const leftNoData = leftGridNoData || leftPoseNoData

  const leftOverlayText = useMemo(() => {
    if (loadPhase === 'error') return t('logreplay.map.loadFailed')
    if (loadPhase === 'init') return t('logreplay.map.initialHint')
    // ✅ 크기 제한 초과는 "수집 대기"나 "데이터 없음"과 달리 확정적 거부 상태이므로 최우선으로 안내
    if (gridOversized) return t('logreplay.map.gridTooLarge')
    if (leftGridNoData && leftPoseNoData) return t('logreplay.map.noMapAndRouteData')
    if (leftGridNoData) return t('logreplay.map.noMapData')
    if (leftPoseNoData) return t('logreplay.map.noRouteData')
    if (!leftHasPts && !leftHasGrid) return t('logreplay.map.waitingPathCollection')
    if (loadPhase !== 'ready') return t('logreplay.map.mcapLoading')
    if (!leftReadyByData) return t('logreplay.map.waitingDataStabilize')
    return ''
  }, [loadPhase, gridOversized, leftGridNoData, leftPoseNoData, leftHasPts, leftHasGrid, leftReadyByData, t])

  // ===============================
  // 우측 센서 차트 게이팅(좌측과 동일한 로딩 Sync)
  // ===============================
  const rightInteractiveReady = loadPhase === 'ready'

  // ✅ 센서 차트는 pose/odom에서 파생되므로, pose가 "없음" 확정이면 차트도 영원히 비어있다.
  //    차트 1개짜리 오버레이 대신, 각 SensorChart 박스 안에 개별적으로 안내를 표시한다.
  const rightNoData = loadPhase === 'ready' && !!poseUnavailable
  const noSensorMsg = rightNoData ? t('logreplay.map.noSensorData') : null

  const rightOverlayText = useMemo(() => {
    if (loadPhase === 'error') return t('logreplay.map.loadFailed')
    if (loadPhase === 'init') return t('logreplay.map.initialHint')
    if (loadPhase !== 'ready') return t('logreplay.map.mcapLoading')
    return ''
  }, [loadPhase, t])

  // ✅ "센서 데이터 없음"은 오버레이 1개로 두 차트를 덮지 않고, 차트마다 개별 안내(SensorChart emptyMessage)로 표시
  const showRightOverlay = loadPhase === 'error' || loadPhase === 'init' || !rightInteractiveReady

  // 시간 라벨(우측 헤더 DOM 반영)
  const timeLabelCurrent = useMemo(() => {
    return (
      (typeof formattedCurrentTime === 'string' && formattedCurrentTime) ||
      (typeof currentTimestampMs === 'number' ? msToClock(currentTimestampMs) : `00:00.000`)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formattedCurrentTime, currentTimestampMs])

  const timeLabelDuration = useMemo(() => {
    if (typeof durationMs === 'number' && durationMs > 0) {
      const durText = (typeof formattedDuration === 'string' && formattedDuration) || msToClock(durationMs)
      return ` / ${durText}`
    }
    return ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formattedDuration, durationMs])

  const rightTimeRef = useRef(null)
  useEffect(() => {
    const el = rightTimeRef.current
    if (!el) return
    el.textContent = `${timeLabelCurrent}${timeLabelDuration}`
  }, [timeLabelCurrent, timeLabelDuration])

  return (
    <div style={S.mapsArea}>
      {/* 좌측: 이동현황 */}
      <LeftMapCard
        canvasRef={canvasRef}
        onCanvasMouseDown={onCanvasMouseDown}
        loadPhase={loadPhase}
        leftPlayable={leftPlayable}
        leftInteractiveReady={leftInteractiveReady}
        leftOverlayText={leftOverlayText}
        leftNoData={leftNoData}
        // ▼ 3D용
        gridData={gridData}
        pathPoints={pathPoints}
        plannedPathPoints={plannedPathPoints}
        fullTrajectoryPoints={fullTrajectoryPoints}
        lidarScans={lidarScans}
        localCostmapFrames={localCostmapFrames}
        odomRawPoints={odomRawPoints}
        dwaGoals={dwaGoals}
        currentTimestampMs={currentTimestampMs}
        t0EpochMs={t0EpochMs}
        gridOversized={gridOversized}
      />

      {/* 우측: 센서 정보 (조회/로딩 Sync 적용) */}
      <div style={S.mapCard}>
        <RightHeader isLoadingLogs={isLoadingLogs} timeLabelRef={rightTimeRef} />

        <div
          style={{
            ...S.mapBody,
            position: 'relative',
            overflowY: 'auto',
            alignItems: 'stretch',
            justifyContent: 'flex-start'
          }}
        >
          {/* ✅ ready일 때만 차트 렌더 (uPlot이 0px에서 그려지는 문제 방지) */}
          {rightInteractiveReady ? (
            chartLoading ? (
              <div
                style={{
                  width: '100%',
                  height: 220 * 2 + 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#888',
                  fontSize: 13
                }}
              >
                {t('logreplay.map.chartDataLoading')}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  // ✅ 세로: '1fr'은 트랙 최소값이 auto(콘텐츠 min-content)라, uPlot이 setSize로
                  //    루트에 박는 명시적 높이가 트랙 최소값이 되어 "전체 높이로 고착"된다.
                  //    minmax(0,1fr)로 최소값 0 고정 → 각 차트가 정확히 절반.
                  gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
                  // ✅ 가로: 컬럼을 명시하지 않으면 암시적 컬럼이 auto라 uPlot 명시 폭보다
                  //    작게 줄지 못해, 컨테이너가 좁아져도 옛 넓은 폭에 고착(우측 잘림)된다.
                  //    minmax(0,1fr)로 컬럼도 0까지 줄 수 있게 한다.
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 12,
                  width: '100%',
                  height: '100%',
                  // ✅ 부모(mapBody)가 flex row이므로 이 그리드는 flex 아이템이다.
                  //    flex 아이템 기본 min-width/min-height: auto(콘텐츠 min-content)라
                  //    콘텐츠(uPlot 명시 폭/높이)보다 작게 못 줄어든다 → 0으로 풀어 shrink 허용.
                  minWidth: 0,
                  minHeight: 0
                }}
              >
                <SensorChart
                  sampleMode={false}
                  data={odomChart1}
                  title="ODOM (derived) Velocity"
                  labels={VEL_LABELS}
                  colors={VEL_COLORS}
                  playheadSec={playheadSec}
                  t0EpochMs={t0EpochMs}
                  xRange={chartXRange}
                  emptyMessage={noSensorMsg}
                />
                <SensorChart
                  sampleMode={false}
                  data={odomChart2}
                  title="ODOM Pose"
                  labels={POSE_LABELS}
                  colors={POSE_COLORS}
                  playheadSec={playheadSec}
                  t0EpochMs={t0EpochMs}
                  xRange={chartXRange}
                  emptyMessage={noSensorMsg}
                />
              </div>
            )
          ) : (
            // overlay가 덮을 거지만, 레이아웃 흔들림 방지용 빈 자리(선택)
            <div style={{ width: '100%', height: 220 * 2 + 12 }} />
          )}

          {/* ✅ 우측 Overlay: 좌측과 동일한 로딩 Sync */}
          {showRightOverlay && (
            <div
              role="status"
              aria-live="polite"
              style={{
                ...S.loadingOverlay,
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              {loadPhase !== 'init' && loadPhase !== 'error' && rightOverlayText ? (
                <>
                  <span
                    aria-hidden
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: '2px solid rgba(0,0,0,0.15)',
                      borderTopColor: '#666',
                      animation: 'map-right-spin 0.9s linear infinite'
                    }}
                  />
                  <span>{rightOverlayText}</span>
                  <style>{`@keyframes map-right-spin {from{transform:rotate(0)} to{transform:rotate(360deg)}}`}</style>
                </>
              ) : (
                <span>{rightOverlayText}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(MapPanels)
