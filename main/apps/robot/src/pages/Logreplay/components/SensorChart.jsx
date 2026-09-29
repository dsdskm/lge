// SensorChart.jsx
import React, { useEffect, useRef, useMemo } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// ✅ uPlot 기본 범례 포맷(Intl.NumberFormat, 소수 3자리)은 -0.0000534 같은 값을
//    "-0"으로 뭉개버려 실제로는 움직였는데 범례엔 0으로 보이는 문제가 있다. 소수 4자리로 고정해 보존한다.
function formatLegendValue(v) {
  return v == null || !Number.isFinite(v) ? '--' : v.toFixed(4)
}

export default React.memo(function SensorChart({
  sampleMode = false,
  data: mcapData,
  title = 'Sensor Data',
  labels = { x: 'X', y: 'Y', z: 'Z' },
  colors = { x: 'red', y: 'blue', z: 'green' },
  playheadSec = null,
  t0EpochMs = null,
  // [min,max] 절대 초. 여러 차트의 x축을 동일 범위로 고정 → 재생 커서가 모든 차트에서 일관되게 보임
  xRange = null,
  // ✅ 데이터가 "확정적으로 없음"일 때만 채워주는 안내 문구(로딩 중엔 null로 비워 기존처럼 빈 박스 유지)
  emptyMessage = null
}) {
  const chartRef = useRef(null)
  const plotRef = useRef(null)

  // 샘플 데이터 생성 (시간 t, x/y/z 센서값)
  function generateSample() {
    const t = []
    const x = []
    const y = []
    const z = []
    for (let i = 0; i < 600; i++) {
      t.push(i)
      x.push(Math.sin(i / 50) + Math.random() * 0.1)
      y.push(Math.cos(i / 60) + Math.random() * 0.1)
      z.push(Math.sin(i / 30) * 0.5 + Math.random() * 0.2)
    }
    return { t, x, y, z }
  }

  const sensor = sampleMode ? generateSample() : mcapData
  const baseSec = t0EpochMs != null ? t0EpochMs / 1000 : 0

  // ✅ 재생 위치 수직선용 ref (플러그인 draw 훅이 매 redraw마다 현재값을 읽는다)
  const baseSecRef = useRef(0)
  baseSecRef.current = baseSec
  const playheadSecRef = useRef(null)
  playheadSecRef.current = playheadSec

  const xTime = useMemo(() => {
    if (!sensor?.t || !Array.isArray(sensor.t)) return []
    return sensor.t.map((v) => v + baseSec)
  }, [sensor, baseSec])

  const hasData = !!(sensor && Array.isArray(sensor.t) && sensor.t.length > 0)

  // x축 고정 범위(전체 주행 구간, 절대 초). 정해지면 plot을 이 범위로 "잠가" setData 시 x가 재-autorange 되지 않게 한다.
  const xMin = Array.isArray(xRange) ? xRange[0] : null
  const xMax = Array.isArray(xRange) ? xRange[1] : null

  // 1) 생성/파기: 구조적 옵션(제목/시리즈/타임베이스/x고정범위)이나 "데이터 유무"가 바뀔 때만.
  //    데이터 "값" 변경으로는 재생성하지 않는다(아래 setData 이펙트가 처리) → 매 갱신마다
  //    uPlot을 파괴·재생성하던 깜빡임/성능 문제 해결.
  useEffect(() => {
    if (!chartRef.current || !hasData) return

    // ✅ 재생 위치 절대 초(= 상대초 + base). 차트 x축(xTime)과 동일 스케일.
    const getPlayheadAbsSec = () => {
      const s = playheadSecRef.current
      return s == null || !Number.isFinite(s) ? null : s + baseSecRef.current
    }

    // uPlot 설정
    const opts = {
      title: sampleMode ? `${title} (Sample)` : title,
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight,
      // ✅ [top,right,bottom,left] px. 루트 .uplot은 width:min-content라 플롯이 컨테이너에
      //    딱 붙어(flush) x축 마지막 눈금 라벨이 오른쪽으로 삐져나가 카드 overflow:hidden에
      //    잘린다. 오른쪽에 여백을 확보해 라벨이 안쪽에 그려지도록 한다.
      //    (bottom/left는 null=축 크기 기준 자동 계산)
      padding: [8, 24, null, null],
      scales: {
        x: {
          time: baseSec > 0,
          // 전체 주행 구간으로 x축 고정(있으면). 정적 range면 setData(resetScales)로도 x가 안 흔들림.
          ...(Number.isFinite(xMin) && Number.isFinite(xMax) ? { range: [xMin, xMax] } : null)
        }
      },
      cursor: { x: false, y: false },
      plugins: [playheadPlugin(getPlayheadAbsSec)],
      series: [
        {}, // x-axis
        { label: labels.x || 'X', stroke: colors.x || 'red', value: (u, v) => formatLegendValue(v) },
        { label: labels.y || 'Y', stroke: colors.y || 'blue', value: (u, v) => formatLegendValue(v) },
        { label: labels.z || 'Z', stroke: colors.z || 'green', value: (u, v) => formatLegendValue(v) }
      ]
    }

    const plot = new uPlot(opts, [xTime, sensor.x, sensor.y, sensor.z], chartRef.current)
    plotRef.current = plot

    const resize = () => {
      const el = chartRef.current
      if (!el) return
      const w = el.clientWidth
      const totalH = el.clientHeight
      // 컨테이너가 일시적으로 0px일 때(숨김/전환 중) setSize 하면 캔버스가 찌그러진다 → 무시
      if (w <= 0 || totalH <= 0) return
      // ✅ uPlot의 height 옵션은 플롯 영역(.u-wrap)만 지정한다. 제목(.u-title)과
      //    범례(.u-legend)는 그 바깥에 흐름상 추가로 쌓이므로, 이들을 빼지 않으면
      //    (제목 + height + 범례)가 컨테이너를 넘쳐 스크롤/겹침이 생긴다.
      const titleH = plot.root.querySelector('.u-title')?.offsetHeight || 0
      const legendH = plot.root.querySelector('.u-legend')?.offsetHeight || 0
      const plotH = Math.max(40, totalH - titleH - legendH)
      // 동일 크기면 불필요한 재그리기 방지
      if (plot.width === w && plot.height === plotH) return
      plot.setSize({ width: w, height: plotH })
    }

    // ✅ 생성 직후 1회 보정: opts.height는 크롬(제목/범례) DOM이 생기기 전 값이라
    //    전체 높이로 잡혀 있으므로, DOM이 준비된 지금 즉시 크롬을 빼고 다시 맞춘다.
    resize()

    // ✅ window resize만으로는 컨테이너 자체의 크기 변화(디버그/설정 패널 개폐,
    //    스크롤바 출현, 사이드바 토글 등)를 감지하지 못해 차트가 옛 크기로 남아 잘린다.
    //    ResizeObserver로 컨테이너를 직접 관찰해 어떤 원인이든 크기 변화에 반응한다.
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => resize())
      ro.observe(chartRef.current)
    }
    // 구형 환경 폴백 겸 안전망
    window.addEventListener('resize', resize)

    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', resize)
      plot.destroy()
      if (plotRef.current === plot) plotRef.current = null
    }
    // xTime/sensor는 생성 시점 스냅샷으로만 사용(값 변경은 아래 setData 이펙트가 처리).
    // xMin/xMax가 바뀌면(로드당 1회) x고정범위를 opts에 박아 재생성 → x축이 잠긴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleMode, title, labels, colors, baseSec, hasData, xMin, xMax])

  // 2) 데이터 값 갱신: 인스턴스 재생성 없이 setData만 → 깜빡임 없음.
  useEffect(() => {
    const plot = plotRef.current
    if (!plot || !hasData) return
    try {
      plot.setData([xTime, sensor.x, sensor.y, sensor.z])
    } catch {
      /* uPlot.setData는 길이 변화에 안전. 예외 시 무시(다음 구조 변경 시 재생성) */
    }
  }, [xTime, sensor, hasData])

  // ✅ 재생성 없이 x고정범위를 재확인(방어적). 생성 effect가 xMin/xMax를 opts.range로 이미 잠그지만,
  //    혹시 재생성 사이 setData가 먼저 타는 경우를 대비해 스케일을 다시 고정한다.
  useEffect(() => {
    const plot = plotRef.current
    if (plot && Number.isFinite(xMin) && Number.isFinite(xMax)) {
      try {
        plot.setScale('x', { min: xMin, max: xMax })
      } catch {}
    }
  }, [xMin, xMax])

  // ✅ 재생 위치가 바뀌면 redraw만 트리거 → 플러그인 draw 훅이 빨간 선을 다시 그림
  //    (캔버스에 직접 그리므로 DOM 좌표/배율(dpr)/z-index 문제 없이 정확히 표시)
  useEffect(() => {
    const plot = plotRef.current
    if (plot) plot.redraw(false)
  }, [playheadSec])

  return (
    <div
      ref={chartRef}
      style={{
        width: '100%',
        height: '100%',
        // ✅ 그리드 아이템 기본 min-width/min-height: auto(콘텐츠 min-content = uPlot 명시 폭/높이)라
        //    트랙(minmax(0,1fr))보다 넓게 오버플로우할 수 있다. 0으로 풀어 트랙 크기까지 줄어들게 하고,
        //    혹시 남는 미세 오버플로우는 여기서 클립(카드까지 넘어가 잘리는 것 방지).
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxSizing: 'border-box',
        position: 'relative'
      }}
    >
      {!hasData && emptyMessage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#374151',
            fontWeight: 600,
            fontSize: 13,
            textAlign: 'center',
            padding: '0 12px'
          }}
        >
          {emptyMessage}
        </div>
      )}
    </div>
  )
})

// ✅ uPlot 플러그인: 재생 위치 빨간 수직선을 캔버스에 직접 그린다.
//    valToPos(...,true)·u.bbox·u.ctx 모두 "캔버스 픽셀" 단위라 좌표가 항상 일치.
function playheadPlugin(getAbsSec) {
  return {
    hooks: {
      draw: (u) => {
        const sec = typeof getAbsSec === 'function' ? getAbsSec() : null
        if (sec == null || !Number.isFinite(sec)) return
        const cx = u.valToPos(sec, 'x', true) // 캔버스 px
        const { left, top, width, height } = u.bbox
        if (!Number.isFinite(cx) || cx < left - 0.5 || cx > left + width + 0.5) return
        const ctx = u.ctx
        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = Math.max(1, Math.round(u.pxRatio || 1))
        ctx.moveTo(cx, top)
        ctx.lineTo(cx, top + height)
        ctx.stroke()
        ctx.restore()
      }
    }
  }
}
