// ReplayControls/hooks/useReplayControlsLogic.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fileApis } from '@/apis'
import { toUtcFromLocalDateTime } from '@/utils/dateUtils'
import { format } from 'date-fns'
import {
  loadMcapTopicsAndSamplesFromUrl,
  loadJointStatesWindowFromUrl,
  prefetchJointWindowAhead
} from '../mcap/replayMcapTopicLoader'
import { DIAGNOSTIC_TOPICS, DIAGNOSTIC_FALLBACK, resolveTopicSamples } from '../utils/topics'

const lichtblickURL = import.meta.env.VITE_LICHTBLICK_BASE_URL

const EMPTY_OPTION = { id: '__empty__', labelKey: 'replayControls.header.noFile' }
const ROSOUT_TOPIC = '/rosout'
const SYSTEM_STATE_TOPIC = '/safety/system_state'

// rosout Log.level → 라벨. ROS1(1/2/4/8/16)과 ROS2(10/20/30/40/50) 둘 다 커버(값 겹치지 않음).
const ROSOUT_LEVEL = {
  1: 'DEBUG',
  2: 'INFO',
  4: 'WARN',
  8: 'ERROR',
  16: 'FATAL',
  10: 'DEBUG',
  20: 'INFO',
  30: 'WARN',
  40: 'ERROR',
  50: 'FATAL'
}

// rosout 샘플 배열 선택: 구간(±10초) lazy load 결과(rosoutSamples) 우선, 없으면 Phase2 sparse 샘플로 폴백.
// textEntries(Text 탭)에서 사용.
function pickRosoutArray(mcapTopicSamples, rosoutSamples) {
  const samples = mcapTopicSamples || {}
  const rosoutKey = samples[ROSOUT_TOPIC] ? ROSOUT_TOPIC : Object.keys(samples).find((k) => /rosout/i.test(k))
  const sparse = (rosoutKey && samples[rosoutKey]) || []
  return Array.isArray(rosoutSamples) && rosoutSamples.length ? rosoutSamples : sparse
}

// 상대초 → MM:SS (System 탭 표기와 동일 계열)
function secToClock(tSec) {
  const s = Math.max(0, Math.floor(Number(tSec) || 0))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function triggerAnchorDownload(href, fileName, openInNewTab = false) {
  const a = document.createElement('a')
  a.style.display = 'none'
  a.href = href
  if (fileName) a.download = fileName
  a.rel = 'noopener'
  if (openInNewTab) a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function parseUrdfJoints(xml) {
  if (!xml || typeof xml !== 'string') return []

  const jointBlocks = xml.match(/<joint[\s\S]*?<\/joint>/g) || []
  const out = []

  for (const block of jointBlocks) {
    const name = block.match(/\bname="([^"]+)"/)?.[1] || null
    const type = block.match(/\btype="([^"]+)"/)?.[1] || null
    const parent = block.match(/<parent\s+link="([^"]+)"/)?.[1] || null
    const child = block.match(/<child\s+link="([^"]+)"/)?.[1] || null

    // fixed 포함해서 둔다. (grouping에 parent/child 관계가 도움됨)
    if (name && parent && child) {
      out.push({ name, type, parent, child })
    }
  }

  return out
}

function buildLinkTree(urdfJoints) {
  const byParent = new Map()
  for (const j of urdfJoints) {
    if (!byParent.has(j.parent)) byParent.set(j.parent, [])
    byParent.get(j.parent).push(j)
  }
  return byParent
}

function collectJointSubtree(rootLink, byParent) {
  if (!rootLink || !byParent) return []

  const out = []
  const stack = [rootLink]
  const visited = new Set()

  while (stack.length) {
    const link = stack.pop()
    if (!link || visited.has(link)) continue
    visited.add(link)

    const children = byParent.get(link) || []
    for (const j of children) {
      out.push(j.name)
      if (j.child) stack.push(j.child)
    }
  }

  return out
}

function uniqueIndices(arr) {
  return Array.from(new Set((Array.isArray(arr) ? arr : []).filter((v) => Number.isInteger(v))))
}

const FINGER_KEYS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']

function emptyHandGroups() {
  return {
    left: {
      Thumb: [],
      Index: [],
      Middle: [],
      Ring: [],
      Pinky: []
    },
    right: {
      Thumb: [],
      Index: [],
      Middle: [],
      Ring: [],
      Pinky: []
    }
  }
}

function detectFingerKey(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('thumb')) return 'Thumb'
  if (n.includes('index')) return 'Index'
  if (n.includes('middle')) return 'Middle'
  if (n.includes('ring')) return 'Ring'
  if (n.includes('pinky') || n.includes('little')) return 'Pinky'
  return null
}

function buildJointGroupsFromSample(sample, robotDescription) {
  const names = Array.isArray(sample?.name) ? sample.name : []
  const lowerNames = names.map((n) => String(n || '').toLowerCase())

  const groups = {
    left: [],
    right: [],
    endEffector: [],
    system: [],
    hands: emptyHandGroups()
  }

  // 1) URDF 파싱
  const urdfJoints = parseUrdfJoints(robotDescription)
  const byParent = buildLinkTree(urdfJoints)

  // 2) root 후보 찾기 (link/joint 이름 기준)
  const leftRoot =
    urdfJoints.find((j) => /left/i.test(j.parent) && /(shoulder|arm|joint)/i.test(j.name))?.parent ||
    urdfJoints.find((j) => /left/i.test(j.parent))?.parent ||
    null

  const rightRoot =
    urdfJoints.find((j) => /right/i.test(j.parent) && /(shoulder|arm|joint)/i.test(j.name))?.parent ||
    urdfJoints.find((j) => /right/i.test(j.parent))?.parent ||
    null

  const leftJointNames = new Set(collectJointSubtree(leftRoot, byParent))
  const rightJointNames = new Set(collectJointSubtree(rightRoot, byParent))

  // 3) 우선 URDF subtree 매핑
  names.forEach((raw, idx) => {
    const n = String(raw || '')
    const ln = n.toLowerCase()

    if (leftJointNames.has(n)) {
      groups.left.push(idx)
    } else if (rightJointNames.has(n)) {
      groups.right.push(idx)
    } else if (
      ln.includes('thumb') ||
      ln.includes('index') ||
      ln.includes('middle') ||
      ln.includes('ring') ||
      ln.includes('pinky') ||
      ln.includes('little') ||
      ln.includes('finger') ||
      ln.includes('gripper') ||
      ln.includes('hand')
    ) {
      groups.endEffector.push(idx)
    } else if (ln.includes('left')) {
      groups.left.push(idx)
    } else if (ln.includes('right')) {
      groups.right.push(idx)
    } else {
      groups.system.push(idx)
    }
  })

  groups.left = uniqueIndices(groups.left)
  groups.right = uniqueIndices(groups.right)
  groups.endEffector = uniqueIndices(groups.endEffector)
  groups.system = uniqueIndices(groups.system)

  // 4) hand / finger 세부 그룹핑
  names.forEach((raw, idx) => {
    const name = String(raw || '')
    const ln = name.toLowerCase()
    const fingerKey = detectFingerKey(name)
    if (!fingerKey) return

    const isLeft = groups.left.includes(idx) || ln.includes('left')
    const isRight = groups.right.includes(idx) || ln.includes('right')

    if (isLeft) {
      groups.hands.left[fingerKey].push(idx)
      groups.endEffector.push(idx)
      return
    }
    if (isRight) {
      groups.hands.right[fingerKey].push(idx)
      groups.endEffector.push(idx)
      return
    }

    // side를 못 찾더라도 finger 계열이면 일단 endEffector로는 넣음
    groups.endEffector.push(idx)
  })

  for (const side of ['left', 'right']) {
    for (const finger of FINGER_KEYS) {
      groups.hands[side][finger] = uniqueIndices(groups.hands[side][finger])
    }
  }

  groups.endEffector = uniqueIndices(groups.endEffector)

  // 5) endEffector가 비면 fallback로 finger/gripper 계열 추출
  if (groups.endEffector.length === 0) {
    lowerNames.forEach((ln, idx) => {
      if (
        ln.includes('thumb') ||
        ln.includes('index') ||
        ln.includes('middle') ||
        ln.includes('ring') ||
        ln.includes('pinky') ||
        ln.includes('little') ||
        ln.includes('finger') ||
        ln.includes('gripper') ||
        ln.includes('hand')
      ) {
        groups.endEffector.push(idx)
      }
    })
    groups.endEffector = uniqueIndices(groups.endEffector)
  }

  // 6) 마지막 fallback
  if (groups.left.length === 0 && groups.right.length === 0 && names.length > 0) {
    groups.left = names.map((_, idx) => idx)
  }

  return groups
}

function mergeSamplesByTSec(baseArr, patchArr) {
  const a = Array.isArray(baseArr) ? baseArr : []
  const b = Array.isArray(patchArr) ? patchArr : []
  if (a.length === 0) return b
  if (b.length === 0) return a

  const merged = [...a, ...b]
  merged.sort((x, y) => (x?.tSec ?? 0) - (y?.tSec ?? 0))

  for (let i = merged.length - 2; i >= 0; i--) {
    if ((merged[i]?.tSec ?? 0) === (merged[i + 1]?.tSec ?? 0)) {
      merged.splice(i, 1)
    }
  }
  return merged
}

/**
 * ReplayControls 전반 로직 훅
 * - 날짜/파일목록/선택/조회/다운로드 등 "ReplayControls"에서 쓸 기능을 계속 흡수할 수 있도록 구성
 */

export default function useReplayControlsLogic({
  deviceId,
  currentTime = 0,
  isPlaying = false,
  // ✅ 사용자 명시적 점프 카운터 getter(index.jsx의 seekEpochRef). 재생 전진에는 증가하지 않는다.
  //    미전달이면 rosout 로더가 "점프 신호 없음"으로 보고 뒤처짐 처리(누적 유지)로만 동작한다.
  getSeekEpoch = null
} = {}) {
  const { t } = useTranslation('robot')
  // ─────────────────────────────────────────────
  // 상태
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(todayStr)

  // 드랍다운 옵션 / 선택값
  const [logOptions, setLogOptions] = useState([EMPTY_OPTION])
  const [selectedLogId, setSelectedLogId] = useState(EMPTY_OPTION.id)

  // 로딩/에러
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [listError, setListError] = useState(null)

  const [isReadingFile, setIsReadingFile] = useState(false)
  const [readError, setReadError] = useState(null)

  const [isPreparingDownload, setIsPreparingDownload] = useState(false)

  // 캘린더 가용 날짜 (yyyy-MM-dd 배열)
  const [allowedDateKeys, setAllowedDateKeys] = useState(null)

  // ✅ MCAP 결과 화면 구성용(토픽/샘플)
  const [mcapTopics, setMcapTopics] = useState([])
  const [mcapTopicStats, setMcapTopicStats] = useState(null)
  const [mcapTopicSamples, setMcapTopicSamples] = useState(null) // { [topic]: [obj,...] }

  const [mcapRobotDescription, setMcapRobotDescription] = useState(null)
  const [jointGroups, setJointGroups] = useState(null)
  // ✅ 차트 전용: 전체 타임라인 joint_states 다운샘플 시리즈(백그라운드 로드).
  //    ±2초 윈도우(mcapTopicSamples)와 분리 — 3D 뷰어용 윈도우는 그대로 두고 차트만 풀-타임라인 표시.
  const [chartTimelineSamples, setChartTimelineSamples] = useState(null) // [{ tSec, msg }]
  // 풀-타임라인 로드 진행 여부: true=불러오는 중(차트는 로딩 표시), false=완료(성공이면 위 시리즈, 실패/빈값이면 null).
  const [isChartTimelineLoading, setIsChartTimelineLoading] = useState(false)
  // Text 로그(rosout) 구간 샘플: currentTime ±10초 윈도우를 lazy load(재생 중 누적)해서 보관.
  const [rosoutSamples, setRosoutSamples] = useState(null) // [{ tSec, msg }]
  // /safety/system_state(UInt8) 전체 샘플 — 상태 전이를 System/Event 로그로 표시
  const [systemStateSamples, setSystemStateSamples] = useState(null) // [{ tSec, msg }]
  const [isParsingMcap, setIsParsingMcap] = useState(false)
  // Phase 1(초기 화면용 joint_states + timeRange) 완료 여부.
  // - false: 초기 로딩 중 → 큰 차단형 스피너
  // - true : 초기 화면 준비됨, Phase 2(나머지 탭)만 백그라운드 진행 → 작은 비차단 표시
  const [isInitialReady, setIsInitialReady] = useState(false)
  const [mcapParseError, setMcapParseError] = useState(null)

  // “읽기” 결과 저장 (추가 동작은 이후)
  const selectedFileMetaRef = useRef(null) // { id,label,createdAt,size,url }
  const currentMcapUrlRef = useRef('')
  const activeJointWindowRef = useRef({ startSec: null, endSec: null })
  const jointWindowSeqRef = useRef(0)
  // 차트 전체 타임라인 백그라운드 로드의 epoch (파일 전환 시 ++ → 진행 중 결과 폐기)
  const chartTimelineSeqRef = useRef(0)
  // rosout lazy load(Logreplay 컨셉: forward 누적): 커버 구간 + per-load epoch + in-flight 가드
  // coveredStart~accEndCovered = 지금까지 로드해 캐시에 담은 시간 범위(빈 구간 포함).
  const coveredStartRef = useRef(null)
  const accEndCoveredRef = useRef(null)
  const rosoutWindowSeqRef = useRef(0)
  const rosoutLoadingRef = useRef(false) // 동시 로드 방지(이게 없으면 매 틱 로드→폐기 루프)
  // ✅ seek 신호 기반 판정용. lastSeekEpoch=마지막으로 관측한 카운터, pendingSeek=아직 반영 못한 점프.
  const getSeekEpochRef = useRef(null)
  const lastSeekEpochRef = useRef(0)
  const pendingSeekRef = useRef(false)
  // 고배속 재생으로 건너뛴 미로드 구간 [{ startSec, endSec }] — 로그 패널에 "여기 빠졌다"고 표시하기 위함.
  const [logGaps, setLogGaps] = useState(null)
  const logGapsRef = useRef([])
  // interval 로더가 최신 값을 읽기 위한 미러 ref (React 렌더와 디커플링)
  const currentTimeRef = useRef(0)
  const mcapTopicsRef = useRef([])
  const mcapTimeRangeRef = useRef(null)

  // 요청 가드(연속 클릭/언마운트 대비) — LogReplay에서 쓰던 방식과 동일 계열
  const requestGuardRef = useRef({ token: 0, cancelled: false })
  const [mcapTimeRange, setMcapTimeRange] = useState(null)

  // ✅ System/Event Log 실데이터: diagnostic 토픽 샘플을 UI용 이벤트로 변환
  // loader 샘플 스키마: { tSec, msg }
  const diagnosticEvents = useMemo(() => {
    const arr = resolveTopicSamples(mcapTopicSamples, DIAGNOSTIC_TOPICS, DIAGNOSTIC_FALLBACK)
    const out = []

    for (const s of arr) {
      const tSec = s?.tSec ?? s?.t
      const msg = s?.msg ?? s?.raw ?? null
      if (!Number.isFinite(tSec) || !msg) continue

      // diagnostic_msgs/msg/DiagnosticArray 케이스(status[])
      if (Array.isArray(msg.status)) {
        for (const st of msg.status) {
          // ✅ ERROR만: DiagnosticStatus.level 2 = ERROR
          if (st?.level !== 2) continue

          out.push({
            tSec,
            level: st?.level,
            source: st?.hardware_id || st?.name || '-',
            message: st?.message || '',
            raw: st
          })
        }
        continue
      }

      // diagnostic_msgs/msg/DiagnosticStatus 케이스(level/name/message/hardware_id)
      if (msg?.level !== 2) continue
      out.push({
        tSec,
        level: msg?.level,
        source: msg?.hardware_id || msg?.name || '-',
        message: msg?.message || '',
        raw: msg
      })
    }

    out.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0))
    return out
  }, [mcapTopicSamples])

  // ✅ /safety/system_state: 값(data)이 바뀌는 "상태 전이"만 System/Event 이벤트로 변환
  const systemStateEvents = useMemo(() => {
    const arr = systemStateSamples || []
    const out = []
    let prev = null
    for (const s of arr) {
      const tSec = s?.tSec ?? s?.t
      const msg = s?.msg ?? s?.raw ?? null
      if (!Number.isFinite(tSec) || !msg) continue
      const val = typeof msg.data === 'number' ? msg.data : null
      if (val == null || val === prev) continue // 변화 시점만(연속 동일값 무시)
      prev = val
      out.push({ tSec, level: null, source: SYSTEM_STATE_TOPIC, message: `system_state = ${val}` })
    }
    return out
  }, [systemStateSamples])

  // ✅ System/Event 로그 = diagnostic 이벤트 + system_state 전이 (시간순 병합)
  const systemEvents = useMemo(() => {
    const merged = [...diagnosticEvents, ...systemStateEvents]
    merged.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0))
    return merged
  }, [diagnosticEvents, systemStateEvents])

  // ✅ Text Log 실데이터: rosout 샘플을 LogEntriesUX 텍스트 탭용 객체로 변환.
  // - 구간(±10초) lazy load 결과(rosoutSamples)가 있으면 그걸, 아니면 Phase 2 sparse 샘플로 폴백
  // - 플레이바 싱크를 위해 tSec 포함
  const textEntries = useMemo(() => {
    const arr = pickRosoutArray(mcapTopicSamples, rosoutSamples)

    const rows = []
    for (const s of arr) {
      const tSec = s?.tSec ?? s?.t
      const msg = s?.msg ?? s?.raw ?? null
      if (!Number.isFinite(tSec) || !msg) continue
      const level = ROSOUT_LEVEL[msg.level] || 'INFO'
      const text = String(msg.msg ?? msg.message ?? '')
      if (!text) continue
      rows.push({ tSec, time: secToClock(tSec), level, message: text })
    }
    rows.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0))
    return rows
  }, [mcapTopicSamples, rosoutSamples])

  // ✅ 개별 이슈 발생(occurrence) 전수 목록 — 시간순 정렬
  // - diagnostic 토픽에서 WARN(level 1) + ERROR(level 2)를 빠짐없이 수집
  // - 플레이바 "이전/다음 이슈" 네비게이션이 발생 단위로 이동하도록 사용 (마커 클러스터와 별개)
  // - rosout은 너무 커질 수 있어 마커 소스에서 제외(구간 lazy load로 전환). diagnostic만 사용.
  //   → 트레이드오프: diagnostic ERROR가 없는 파일은 플레이바 마커가 0개(의도된 동작).
  const replayIssuePoints = useMemo(() => {
    const LEVEL_LABEL = { 1: 'WARN', 2: 'ERROR' }
    const arr = resolveTopicSamples(mcapTopicSamples, DIAGNOSTIC_TOPICS, DIAGNOSTIC_FALLBACK)
    const collected = []

    for (const s of arr) {
      const tSec = s?.tSec ?? s?.t
      const msg = s?.msg ?? s?.raw ?? null
      if (!Number.isFinite(tSec) || !msg) continue

      const statuses = Array.isArray(msg.status) ? msg.status : [msg]
      for (const st of statuses) {
        const level = LEVEL_LABEL[st?.level]
        if (!level) continue // OK(0)/STALE(3) 제외
        collected.push({
          t: tSec,
          level,
          source: st?.hardware_id || st?.name || '-',
          message: st?.message || '',
          origin: 'system' // System/Event 탭 출신 → 클릭 시 해당 탭으로 이동
        })
      }
    }

    collected.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
    return collected
  }, [mcapTopicSamples])

  // ✅ 플레이바 마커용 클러스터 (구간 밴드)
  // - 동일 (level/source/message)가 1초 이내 연속되면 첫 마커에 흡수하여 마커 폭주를 방지
  // - t=구간 시작, tEnd=구간 끝, count=대표 건수
  const replayIssues = useMemo(() => {
    const MERGE_GAP_SEC = 1.0
    const stateByKey = new Map() // key -> { idx, lastT }
    const out = []
    for (const ev of replayIssuePoints) {
      const key = `${ev.level}|${ev.source}|${ev.message}`
      const st = stateByKey.get(key)
      if (st != null && ev.t - st.lastT < MERGE_GAP_SEC) {
        out[st.idx].count += 1
        out[st.idx].tEnd = ev.t // 구간 끝 연장
        st.lastT = ev.t
        continue
      }
      out.push({ ...ev, tEnd: ev.t, count: 1 })
      stateByKey.set(key, { idx: out.length - 1, lastT: ev.t })
    }
    return out
  }, [replayIssuePoints])

  // ✅ 플레이바 카운트 라벨용 "실제 총계" (클러스터/병합과 무관하게 전수 집계)
  // - replayIssuePoints(전수: diagnostic WARN/ERROR)를 레벨별로 합산
  //   → 마커/네비게이션과 카운트가 항상 동일한 소스를 공유
  const issueCounts = useMemo(() => {
    let err = 0
    let warn = 0
    for (const ev of replayIssuePoints) {
      if (ev.level === 'ERROR') err++
      else if (ev.level === 'WARN') warn++
    }
    return { err, warn }
  }, [replayIssuePoints])

  // presigned URL 캐시 — LogReplay에서 쓰던 방식과 동일 계열
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
    } catch {
      // URL 파싱 실패 → 캐시 스킵
    }
    return url
  }, [])

  // ─────────────────────────────────────────────
  // 입력 핸들러(컨트롤러)
  const onDateChange = useCallback((dateStr) => {
    setSelectedDate(dateStr)
  }, [])

  const onLogChange = useCallback((value) => {
    setSelectedLogId(value)
  }, [])

  // ─────────────────────────────────────────────
  // (1)(2) 파일 목록 조회 (첫번째 조회 버튼 + 페이지 로드시 자동)
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
      console.warn('[ReplayControls] 파일 목록 조회 실패:', e?.message || String(e))
      setLogOptions([EMPTY_OPTION])
      setSelectedLogId(EMPTY_OPTION.id)
    }
  }, [selectedDate, selectedLogId, deviceId])

  // (1) 페이지 로드시 오늘 날짜로 자동 조회 (mount 1회)
  useEffect(() => {
    handleFetchListClick()
  }, [])

  // [핵심] 첫 진입 시, Calendar가 자동 호출해주지 않으니 우리가 직접 1회 호출
  useEffect(() => {
    const { startDate, endDate } = computeVisibleRangeForMonth(selectedDate)
    handleVisibleRangeChange({ startDate, endDate })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  //캘린더에 해당하는는 파일 목록 조회
  const handleVisibleRangeChange = useCallback(
    async ({ startDate, endDate }) => {
      const toDateKey = (v) => {
        if (!v) return ''
        const d = typeof v === 'string' ? new Date(v) : v
        // 로컬(KST) 기준 키. toISOString(UTC)는 그리드 경계 날짜를 하루 밀어 마지막 날 로그를 누락시킬 수 있음.
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
              // 캘린더(filterDate)가 로컬(KST) 기준 'yyyy-MM-dd'로 비교하므로 동일하게 로컬 기준으로 버킷팅.
              // (toISOString = UTC 기준이라 KST 오전 로그가 전날로 밀려 당일 클릭이 막히던 버그 수정)
              .map((d) => format(d, 'yyyy-MM-dd'))
          )
        ).sort()

        setAllowedDateKeys(dates)
      } catch (e) {
        console.error('[ReplayControls] 가능 날짜 조회 실패:', e)
        setAllowedDateKeys([])
      }
    },
    [deviceId]
  )

  // ─────────────────────────────────────────────
  // 차트 전용: 전체 타임라인 joint_states를 시간 간격 다운샘플(≈400포인트)로 1회 로드.
  // - readMessages는 전체 구간을 훑지만 timeDownsampleMs로 "유지할 샘플만" 디코드 → 전수 디코드 회피
  // - skipPrefetch: 전체 청크를 한 번에 prefetch하지 않고 블록 캐시 통해 순차 스트리밍(백그라운드 부담↓)
  // - chartTimelineSeqRef로 파일 전환 시 진행 중 결과 폐기
  const loadChartTimelineInBackground = useCallback(async (downloadUrl, tr, collectStTopic = null) => {
    const seq = chartTimelineSeqRef.current
    // 같은 파일(seq 동일)일 때만 로딩 플래그 해제 — 파일 전환되면 새 로드가 관리.
    const finishLoading = () => {
      if (seq === chartTimelineSeqRef.current) setIsChartTimelineLoading(false)
    }

    const durationSec = tr ? Number(tr.endSec) - Number(tr.startSec) : NaN
    if (!downloadUrl || !tr || !Number.isFinite(durationSec) || durationSec <= 0) {
      finishLoading()
      return
    }

    // 2-pass: coarse(가벼움)로 첫 그림을 빨리 띄우고, fine으로 디테일 보강.
    const runPass = async ({ targetPoints, maxChunks, collectSystemState = false }) => {
      const downsampleMs = Math.max(50, Math.floor((durationSec * 1000) / targetPoints))
      // [B] system_state 편승 수집: chart 패스가 읽는 "같은 청크"에서 전이를 모아둔다(별도 refine 패스/다운로드 없음).
      //     onExtraMessage로 흘러온 raw 샘플을 여기 누적 → 스캔 종료 후 정렬(dedupe 안 함=전이 보존)해 1회 반영.
      const collectSt = collectSystemState && collectStTopic ? [] : null
      const res = await loadJointStatesWindowFromUrl(downloadUrl, {
        topic: '/joint_states',
        startSec: 0,
        endSec: durationSec + 2, // 파일 끝까지 (readMessages가 endTime으로 클램프)
        timeDownsampleMs: downsampleMs,
        maxMessages: targetPoints + 200,
        skipPrefetch: true,
        maxChunks,
        extraTopics: collectSt ? [collectStTopic] : [],
        onExtraMessage: collectSt ? (_topic, sample) => collectSt.push(sample) : null
      })
      if (seq !== chartTimelineSeqRef.current) return false // 파일 전환됨 → 폐기
      if (res?.samples?.length) setChartTimelineSamples(res.samples) // 즉시 반영 → 스피너 종료
      // [B] fine은 ~90청크(refine 40보다 많음)를 읽으므로 전이 커버리지 ≥ 기존 refine.
      if (collectSt && collectSt.length) {
        collectSt.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0))
        setSystemStateSamples(collectSt)
      }
      return true
    }

    try {
      // 1차: 가볍게(~25청크/≈120pt) → 차트 첫 그림 빠르게
      await runPass({ targetPoints: 120, maxChunks: 25 })
      if (seq !== chartTimelineSeqRef.current) return
      // 2차: 디테일 보강(기존 수준 ~90청크/≈400pt) + system_state 편승 수집(B)
      await runPass({ targetPoints: 400, maxChunks: 90, collectSystemState: true })
    } catch (e) {
      console.warn('[ReplayControls] 차트 풀-타임라인 로드 실패:', e?.message || String(e))
    } finally {
      finishLoading()
    }
  }, [])

  // ─────────────────────────────────────────────
  // (3) 두번째 조회: 선택된 파일 "읽기" (지금은 bytes만 읽어서 ref에 저장)
  const handleViewSelectedFile = useCallback(async () => {
    if (!selectedLogId || selectedLogId === EMPTY_OPTION.id) return null
    const selected = logOptions.find((l) => l.id === selectedLogId)
    if (!selected) return null

    // 새 파일 읽기 시작할 때 이전 결과 초기화(UX)
    setIsReadingFile(true)
    setReadError(null)

    setIsParsingMcap(true)
    setMcapParseError(null)
    setMcapTopics([])
    setMcapTopicStats(null)
    setMcapTopicSamples(null)
    setMcapRobotDescription(null)
    setJointGroups(null)
    setChartTimelineSamples(null) // 파일 전환 시 차트 풀-타임라인 무효화
    setIsChartTimelineLoading(true) // 새 파일 → 풀-타임라인 로드 예정(차트는 로딩 표시)
    setRosoutSamples(null) // 파일 전환 시 rosout 캐시 무효화
    coveredStartRef.current = null // rosout 커버 구간 리셋
    accEndCoveredRef.current = null
    rosoutWindowSeqRef.current++ // 진행 중인 rosout 로드 폐기(interval 로더의 seq 가드)
    rosoutLoadingRef.current = false // in-flight 가드 해제
    // seek 신호/미로드 구간도 파일 전환 시 초기화(이전 파일의 판정 상태가 새 파일로 새지 않게)
    lastSeekEpochRef.current = typeof getSeekEpochRef.current === 'function' ? Number(getSeekEpochRef.current()) || 0 : 0
    pendingSeekRef.current = false
    logGapsRef.current = []
    setLogGaps(null)
    setSystemStateSamples(null) // 파일 전환 시 system_state 샘플 무효화(메인스캔/차트 편승 시 다시 채움)
    setMcapTimeRange(null) // 파일 전환 시 이전 timeRange 무효화 (playhead effect 오작동 방지)
    setIsInitialReady(false) // 파일 전환 시 다시 초기 로딩 단계로

    currentMcapUrlRef.current = ''
    activeJointWindowRef.current = { startSec: null, endSec: null }
    jointWindowSeqRef.current = 0
    chartTimelineSeqRef.current++ // 진행 중인 차트 풀-타임라인 백그라운드 로드 폐기

    try {
      const downloadUrl = await getPresignedUrl(selectedLogId)
      if (!downloadUrl) throw new Error('다운로드 URL이 설정되지 않았습니다.')

      selectedFileMetaRef.current = { ...selected, url: downloadUrl }
      currentMcapUrlRef.current = downloadUrl
      // ============================================================
      // 1) A 방식: 초기 화면에 필요한 /joint_states 현재 구간만 먼저 로드
      //    - 전체 timeline 샘플 수집보다 먼저 끝나도록 분리
      // ============================================================
      let nextSamples = {}
      let phase1TimeRange = null

      // Phase 1a: 처음 3초 스캔
      try {
        const jointWindow = await loadJointStatesWindowFromUrl(downloadUrl, {
          topic: '/joint_states',
          startSec: 0,
          endSec: 3,
          maxMessages: 800,
          timeDownsampleMs: 0,
          baseAbsStartSec: null
        })
        if (jointWindow?.timeRange) phase1TimeRange = jointWindow.timeRange
        if (jointWindow?.samples?.length) {
          nextSamples = { ['/joint_states']: jointWindow.samples }
          activeJointWindowRef.current = { startSec: 0, endSec: 3 }
        }
      } catch (e) {
        console.warn('[ReplayControls] joint_states 초기 구간([0,3s]) 로드 실패:', e?.message || String(e))
      }

      // Phase 1b: 3초 안에 없으면 파일 전체를 순차 탐색 (prefetch 없이 → 첫 청크들만 읽음)
      if (!nextSamples['/joint_states']?.length) {
        try {
          const jointWindowFull = await loadJointStatesWindowFromUrl(downloadUrl, {
            topic: '/joint_states',
            startSec: 0,
            endSec: 3600, // 최대 1시간 (실제 파일 끝에서 자동 종료)
            maxMessages: 800,
            skipPrefetch: true, // 전체 prefetch 없이 순차 탐색 (planTopicChunks 그룹 prefetch로 첫 청크들만 읽음)
            timeDownsampleMs: 0,
            baseAbsStartSec: null
          })
          if (jointWindowFull?.timeRange) phase1TimeRange = jointWindowFull.timeRange
          if (jointWindowFull?.samples?.length) {
            nextSamples = { ['/joint_states']: jointWindowFull.samples }
          }
        } catch (e) {
          console.warn('[ReplayControls] joint_states 전체 탐색 폴백 실패:', e?.message || String(e))
        }
      }
      // ✅ 초기 joint window만으로도 일단 UI 먼저 표시
      const initialJsSample = nextSamples?.['/joint_states']?.[0]?.msg ?? null
      const initialJointGroups = buildJointGroupsFromSample(initialJsSample, null)

      setMcapTopicSamples(nextSamples || null) // /joint_states만 채워진 상태
      setJointGroups(initialJointGroups || null)
      // ✅ timeRange를 Phase 2 이전에 미리 설정 → 재생/탐색이 Phase 2를 기다리지 않고 즉시 동작
      if (phase1TimeRange) setMcapTimeRange(phase1TimeRange)
      setIsInitialReady(true) // 초기 화면 준비 완료 → 큰 스피너 종료, 이후 Phase 2는 백그라운드 표시

      // ============================================================
      // 2) 나머지 메타/샘플은 이후 병합 (백그라운드)
      //    - /joint_states 제외: 100Hz×300초=3만개 메시지 반복 → 스캔 13초 유발
      // ============================================================
      const { topics, stats, samples, timeRange, robotDescription } = await loadMcapTopicsAndSamplesFromUrl(
        downloadUrl,
        {
          sampleTopics: [
            // diagnostic/actuator는 구(hmc_ros2_control)·신(ethercat_hardware_interface) 이름을 모두 로드
            '/hmc_ros2_control/diagnostic',
            '/ethercat_hardware_interface/diagnostic',
            '/hmc_ros2_control/actuator_states',
            '/ethercat_hardware_interface/actuator_states',
            '/tracking_controller/joint',
            '/battery/battery_status', // Performance 탭 배터리/전력 표시용
            SYSTEM_STATE_TOPIC // System/Event 로그용 — 별도 백그라운드 로드(~12s) 대신 메인스캔에 편승(추가 다운로드 0)
            // /rosout 제외: 텍스트 로그라 양이 많아 메인 스캔(→System 로그)을 지연시킴.
            //              rosout은 아래 currentTime ±10초 구간 lazy load로 별도 처리.
          ],
          // diagnostic/actuator/tracking은 저빈도(~5Hz, 전체 수백 개)라 전수 로드해도 비용이 미미하다.
          // 샘플 상한을 크게 잡아 diagnostic 메시지를 빠짐없이 디코드 → 에러/경고 카운트를 정확히 집계.
          samplePerTopic: 5000,
          maxScanMessages: 60000,
          // URDF 로드 즉시(스캔 완료 전) 로봇 3D 뷰어를 그릴 수 있도록 조기 반영
          onRobotDescription: (desc) => {
            if (!desc) return
            setMcapRobotDescription(desc)
            const jsS = nextSamples?.['/joint_states']?.[0]?.msg ?? null
            setJointGroups(buildJointGroupsFromSample(jsS, desc) || null)
          },
          // 토픽 목록 + Statistics 기반 count/hz를 스캔 완료 전에 먼저 반영 → Overview ROS Topics 조기 표시
          onTopicsAndStats: ({ topics, stats }) => {
            setMcapTopics(topics || [])
            setMcapTopicStats(stats || null)
          }
        }
      )
      // ✅ system_state 전이(System 로그)를 메인스캔 결과에서 직접 추출 → 별도 백그라운드 로드(~12s) 제거.
      const stKey = Object.keys(samples || {}).find((k) => /system_state/i.test(k))
      const stSamples = (stKey && samples[stKey]?.length && samples[stKey]) || null
      setSystemStateSamples(stSamples)

      nextSamples = {
        ...(samples || {}),
        ['/joint_states']: nextSamples['/joint_states'] || [] // Phase 1 결과 유지
      }

      const jsSample = nextSamples?.['/joint_states']?.[0]?.msg ?? null
      const nextJointGroups = buildJointGroupsFromSample(jsSample, robotDescription)

      setMcapTopics(topics || [])
      setMcapTopicStats(stats || null)
      setMcapTopicSamples(nextSamples || null)
      setMcapRobotDescription(robotDescription || null)
      setJointGroups(nextJointGroups || null)
      setMcapTimeRange(timeRange || phase1TimeRange || null)

      // ============================================================
      // 3) 백그라운드 풀-스캔: 비차단 (await 안 함)
      //    - chart(coarse→fine)가 system_state를 "편승 수집"(B) → 같은 청크에서 전이 확보, 별도 refine 패스 제거.
      //    - System 로그 근사본은 위 메인스캔(Phase 2)에서 이미 떠 있고, chart-fine이 완전본으로 교체.
      //    - rosout은 currentTime ±10초 구간 lazy load(interval 로더)로 별도 처리.
      // ============================================================
      const _bgTr = timeRange || phase1TimeRange
      // [B] system_state 토픽 해석(topics 카탈로그 기준, refine과 동일 로직) → chart 편승 수집 대상으로 전달.
      const stTopicForChart = (() => {
        const names = (topics || []).map((t) => t.topic)
        if (names.includes(SYSTEM_STATE_TOPIC)) return SYSTEM_STATE_TOPIC
        return names.find((tp) => /system_state/i.test(String(tp || ''))) || null
      })()
      // [B] system_state는 chart-fine 패스가 같은 청크에서 편승 수집(별도 refine 패스 없음, 추가 다운로드 ≈0, dup 0).
      loadChartTimelineInBackground(downloadUrl, _bgTr, stTopicForChart).catch(() => {})

      return { meta: selectedFileMetaRef.current }
    } catch (e) {
      setReadError(e)
      setMcapParseError(e)
      setIsChartTimelineLoading(false) // 로드 실패 → 차트 로딩 표시 해제(무한 로딩 방지)
      console.warn('[ReplayControls] 파일 로드 실패:', e?.message || String(e))
      return null
    } finally {
      setIsReadingFile(false)
      setIsParsingMcap(false)
    }
  }, [selectedLogId, logOptions, getPresignedUrl, loadChartTimelineInBackground])

  // Lichtblick
  const handleOpenLichtblick = useCallback(async () => {
    if (!selectedLogId || selectedLogId === EMPTY_OPTION.id) return

    const selected = logOptions.find((l) => l.id === selectedLogId)
    if (!selected) return

    const downloadUrl = await getPresignedUrl(selectedLogId)
    if (!downloadUrl) {
      alert(t('replayControls.header.lichtblickUrlNotFound'))
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
  }, [selectedLogId, logOptions, getPresignedUrl])

  // ─────────────────────────────────────────────
  // (4) 다운로드 버튼: 선택 파일 다운로드
  const handleDownloadLog = useCallback(async () => {
    if (!selectedLogId || selectedLogId === EMPTY_OPTION.id) return
    const selected = logOptions.find((l) => l.id === selectedLogId)
    if (!selected) return

    const fallbackFileName = selected?.label?.replace(/\s+/g, '_') || `${selected?.id || 'file'}`

    setIsPreparingDownload(true)

    let downloadUrl
    try {
      downloadUrl = await getPresignedUrl(selectedLogId)
    } catch (err) {
      console.warn('[ReplayControls] 다운로드: presigned URL 조회 실패:', err?.message || String(err))
      setIsPreparingDownload(false)
      alert(t('replayControls.header.downloadUrlMissing'))
      return
    }
    if (!downloadUrl) {
      setIsPreparingDownload(false)
      alert(t('replayControls.header.downloadUrlMissing'))
      return
    }

    // presigned URL로 직접 다운로드시켜 브라우저 자체 다운로드 진행률을 그대로 사용한다.
    // (fetch → blob 방식은 다운로드가 다 끝날 때까지 진행률이 전혀 안 보이고, 응답이 안 오면 무한정 멈춘다)
    // openInNewTab=true로 두면 새 탭이 잠깐 열렸다 닫히며 화면이 깜박이므로 새 탭을 띄우지 않는다.
    setIsPreparingDownload(false)
    triggerAnchorDownload(downloadUrl, fallbackFileName)
  }, [selectedLogId, logOptions, getPresignedUrl, t])

  // 언마운트 시 후속 setState 차단
  useEffect(() => {
    return () => {
      requestGuardRef.current.cancelled = true
    }
  }, [])

  // ─────────────────────────────────────────────
  // Step3: playhead 따라 /joint_states window 재로딩
  // - currentTime 기준 ±2초
  // - 현재 활성 window 안쪽이면 skip
  // - 새 window가 오면 /joint_states만 현재 구간 데이터로 교체
  // ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const downloadUrl = currentMcapUrlRef.current
      const tr = mcapTimeRange
      const center = Number(currentTime)

      if (!downloadUrl) return
      // mcapTimeRange는 파일 전환 시 null로 초기화되고 Phase 1 직후에야 설정되므로,
      // 이 가드만으로 "초기 로드 미완료" 상태를 충분히 차단한다.
      // (isParsingMcap 가드를 두면 Phase 2 동안 탐색/재생이 막히므로 제거)
      if (!tr || !Number.isFinite(tr.absStartSec) || !Number.isFinite(tr.endSec)) return
      if (!Number.isFinite(center)) return

      // 뒤쪽을 넓게 담는 비대칭 window.
      // ArmAnalysisTab의 안정성/파생이벤트가 "현재 시점 직전 ~120샘플"을 lookback하므로,
      // 뒤쪽(BACK)을 넉넉히 로드해 재생/점프 어느 경로로 도달해도 동일한 lookback을 결정론적으로 보장.
      // 앞쪽(FWD)은 재생 시 다음 리로드까지의 여유분.
      const BACK = 4
      const FWD = 2
      const SAFE_MARGIN = 0.5

      const active = activeJointWindowRef.current || {}
      if (
        Number.isFinite(active.startSec) &&
        Number.isFinite(active.endSec) &&
        center >= active.startSec + SAFE_MARGIN &&
        center <= active.endSec - SAFE_MARGIN
      ) {
        return
      }

      const startSec = Math.max(0, center - BACK)
      const endSec = Math.min(Number(tr.endSec || 0), center + FWD)
      if (!(endSec > startSec)) return

      const seq = ++jointWindowSeqRef.current

      // MCAP Statistics(channelMessageCounts)에서 얻은 실측 평균 Hz로 cap을 동적으로 잡는다.
      // - 스캔에서 제외된 /joint_states도 baseline(파일 전체 평균)으로 채워져 있음(buildBaselineStatsFromStatistics).
      // - 실측값이 없으면(Phase 2 완료 전 등) 기존 하드코딩값(300Hz 가정치)으로 폴백.
      // - 안전마진(1.5배)만큼 여유를 둬 평균 대비 지역적 버스트에도 잘리지 않게 함.
      const jsHz = Number(mcapTopicStats?.['/joint_states']?.hz)
      const HZ_SAFETY = 1.5
      const FALLBACK_MAX_MESSAGES = 1800 // 6초 × ~300Hz 헤드룸(실측 Hz 없을 때만 사용)
      const dynamicMaxMessages = Number.isFinite(jsHz) && jsHz > 0
        ? Math.max(200, Math.ceil((BACK + FWD) * jsHz * HZ_SAFETY))
        : FALLBACK_MAX_MESSAGES

      try {
        const jointWindow = await loadJointStatesWindowFromUrl(downloadUrl, {
          topic: '/joint_states',
          startSec,
          endSec,
          maxMessages: dynamicMaxMessages,
          timeDownsampleMs: 0,
          baseAbsStartSec: tr?.absStartSec ?? 0
        })

        if (cancelled) return
        if (seq !== jointWindowSeqRef.current) return

        const windowSamples = jointWindow?.samples || []
        if (!windowSamples.length) return

        activeJointWindowRef.current = { startSec, endSec }

        // [③] 전진 재생 중이면 다음 윈도우 청크를 선행 prefetch(캐시 워밍 → 다음 로드가 캐시 히트, 부드러움).
        //     additive: 샘플/병합엔 영향 없음. 추가 바이트 ≈0(재생하며 읽을 청크, 이미 캐시면 skip).
        if (isPlaying) {
          const AHEAD = 8 // 선행 폭(초). 9x에서도 다음 리로드들을 캐시 히트로 흡수.
          const aheadStart = endSec
          const aheadEnd = Math.min(Number(tr.endSec || 0), endSec + AHEAD)
          if (aheadEnd > aheadStart) {
            prefetchJointWindowAhead(downloadUrl, {
              startSec: aheadStart,
              endSec: aheadEnd,
              baseAbsStartSec: tr?.absStartSec ?? 0
            }).catch(() => {})
          }
        }

        setMcapTopicSamples((prev) => {
          // ✅ 항상 replace: 현재 시점 중심 window만 보관한다.
          // - 이 페이지는 trail(궤적) 시각화가 없고, 소비자는 currentTime 한 지점을 binary search로 읽거나
          //   (ArmAnalysisTab) 직전 ~120샘플만 lookback한다. 비대칭 window(BACK)가 그 lookback을 이미 포함.
          // - 누적하면 지표가 재생 이력(재생 vs 점프 경로)에 의존해 값이 비일관해지므로 하지 않는다.
          const next = [...windowSamples].sort((a, b) => (a?.tSec ?? 0) - (b?.tSec ?? 0))
          for (let i = next.length - 2; i >= 0; i--) {
            if ((next[i]?.tSec ?? 0) === (next[i + 1]?.tSec ?? 0)) {
              next.splice(i, 1)
            }
          }

          return {
            ...(prev || {}),
            ['/joint_states']: next
          }
        })

        // ✅ window 기준으로 그룹 재계산
        const jsSample = windowSamples?.[0]?.msg ?? null
        const nextJointGroups = buildJointGroupsFromSample(jsSample, mcapRobotDescription)
        setJointGroups(nextJointGroups || null)
      } catch (e) {
        if (cancelled) return
        console.warn('[ReplayControls] 재생 위치 joint_states 로드 실패:', e?.message || String(e))
      }
    }

    const timer = setTimeout(run, 80)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [currentTime, mcapTimeRange, isParsingMcap, mcapRobotDescription, mcapTopicStats])

  // interval 로더가 최신 값을 읽도록 props/state를 ref로 미러링(React 렌더와 디커플링)
  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])
  useEffect(() => {
    mcapTopicsRef.current = mcapTopics
  }, [mcapTopics])
  useEffect(() => {
    mcapTimeRangeRef.current = mcapTimeRange
  }, [mcapTimeRange])
  // mount-once interval 로더가 최신 getter를 쓰도록 미러링(getter 교체에도 재구독 불필요)
  useEffect(() => {
    getSeekEpochRef.current = typeof getSeekEpoch === 'function' ? getSeekEpoch : null
  }, [getSeekEpoch])

  // ─────────────────────────────────────────────
  // Step3': rosout(Text 로그) lazy load — Logreplay 컨셉(폴링 interval + forward 누적)
  // - mount-once interval이 currentTimeRef를 읽어 로드. currentTime 변화에 로드가 취소되지 않음.
  // - 커버 구간 [coveredStart, accEndCovered]를 추적. 현재 시점이 커버 안이면 skip(빈 구간도 커버로 마킹).
  // - 재생/앞으로 진행: accEndCovered부터 forward로 확장해 "시작부터 현재까지" 캐시를 채운다(콘솔처럼 누적).
  // - seek(큰 점프/역방향): center 주변 ±SEEK_HALF로 교체(REPLACE)하고 커버를 리셋.
  // - rosoutLoadingRef: 동시 로드 1건 제한. rosoutWindowSeqRef: 파일 전환 무효화 epoch.
  //   ※ Logreplay useLogReplayData.requestLogWindow(accEndCoveredRef/forward 확장)와 동일 패턴.
  // ─────────────────────────────────────────────
  useEffect(() => {
    let stopped = false

    const mergeForward = (prev, add) => {
      const merged = [...(Array.isArray(prev) ? prev : []), ...add]
      merged.sort((a, b) => (a?.tSec ?? 0) - (b?.tSec ?? 0))
      const seen = new Set()
      const out = []
      for (const s of merged) {
        const m = s?.msg
        const key = `${s?.tSec ?? ''}|${m?.msg ?? m?.message ?? ''}` // 동시각 다중 로그 보존, 중복만 제거
        if (seen.has(key)) continue
        seen.add(key)
        out.push(s)
      }
      const MAX = 5000
      if (out.length > MAX) out.splice(0, out.length - MAX)
      return out
    }

    // 빈 구간 기록 유틸 ─────────────────────────────
    const GAP_EPS = 0.05 // 초. 부동소수 오차/무의미하게 좁은 조각 무시
    // 맞닿은(또는 겹친) 구간만 하나로 합친다.
    // ⚠️ 떨어져 있는 구간은 절대 합치지 않는다 — 사이에 실제로 받아둔 로그가 있으므로,
    //    합치면 있는 데이터를 "미로드"라고 잘못 표시하게 된다.
    const mergeGapRecords = (list) => {
      const arr = (Array.isArray(list) ? list : [])
        .filter((g) => Number.isFinite(g?.startSec) && Number.isFinite(g?.endSec) && g.endSec - g.startSec > GAP_EPS)
        .sort((a, b) => a.startSec - b.startSec)
      const out = []
      for (const g of arr) {
        const last = out[out.length - 1]
        if (last && g.startSec - last.endSec <= GAP_EPS) last.endSec = Math.max(last.endSec, g.endSec)
        else out.push({ startSec: g.startSec, endSec: g.endSec })
      }
      return out
    }
    // 실제로 받아온 범위 [s,e]를 빈 구간 기록에서 빼낸다(부분만 겹치면 앞/뒤 잔여 구간으로 분할).
    const subtractGapRange = (list, s, e) => {
      const out = []
      for (const g of Array.isArray(list) ? list : []) {
        if (e <= g.startSec || s >= g.endSec) {
          out.push(g)
          continue
        }
        if (g.startSec < s - GAP_EPS) out.push({ startSec: g.startSec, endSec: Math.min(s, g.endSec) })
        if (g.endSec > e + GAP_EPS) out.push({ startSec: Math.max(e, g.startSec), endSec: g.endSec })
      }
      return out
    }

    const tick = async () => {
      if (stopped || rosoutLoadingRef.current) return

      const downloadUrl = currentMcapUrlRef.current
      const tr = mcapTimeRangeRef.current
      const center = Number(currentTimeRef.current)
      if (!downloadUrl || !tr || !Number.isFinite(tr.absStartSec) || !Number.isFinite(tr.endSec)) return
      if (!Number.isFinite(center)) return

      const rosoutTopic = (mcapTopicsRef.current || [])
        .map((t) => t.topic)
        .find((tp) => /rosout/i.test(String(tp || '')))
      if (!rosoutTopic) return

      const trEnd = Number(tr.endSec || 0)
      const PLAY_HALF = 12 // forward 확장 시 현재보다 얼마나 앞까지 미리 로드할지
      const SEEK_HALF = 10 // seek 시 center 주변 폭
      // 재생이 로딩을 앞질렀을 때 한 번에 이어붙일 최대 폭(초).
      // 이보다 더 벌어지면 중간을 건너뛰고 현재 위치 주변만 받는다(누적은 유지 = 과거 로그를 버리지 않음).
      // ⚠️ 이 값은 "사용자가 점프했는지" 판정과 무관하다(그건 아래 에폭 신호가 담당). 순수 백프레셔 한계값.
      const MAX_CATCHUP_SPAN = 20

      // ✅ 사용자 점프 신호 소비: 추측하지 않고 index.jsx의 seekEpoch 변화만 본다.
      //    재생 타이머는 onPlayTick으로 분리돼 에폭을 올리지 않으므로, 고배속 재생이 점프로 오판될 수 없다.
      const getEpoch = getSeekEpochRef.current
      if (typeof getEpoch === 'function') {
        let cur = lastSeekEpochRef.current
        try {
          cur = Number(getEpoch()) || 0
        } catch {
          /* getter 실패는 무해: 이전 값 유지 = 점프 없음으로 취급 */
        }
        if (cur !== lastSeekEpochRef.current) {
          lastSeekEpochRef.current = cur
          pendingSeekRef.current = true
        }
      }

      const covStart = coveredStartRef.current
      const covEnd = accEndCoveredRef.current
      const hasCov = Number.isFinite(covStart) && Number.isFinite(covEnd)

      // 현재 시점이 이미 커버된 구간 안이면 로드 불필요(콘솔은 캐시에서 표시).
      // 이 경우 점프였더라도 이미 필요한 데이터가 있으므로 신호를 여기서 해소한다.
      // (해소하지 않으면 나중에 재생으로 커버 끝을 넘을 때 낡은 신호가 seek으로 오작동함)
      // 단, 커버 구간 안이라도 "건너뛴 빈 구간"이면 실제 데이터가 없으므로 그 구간을 채운다(mode='fill').
      // 교체가 아니라 채우기여야 쌓아둔 로그가 날아가지 않는다.
      const insideCoverage = hasCov && center >= covStart && center <= covEnd
      const validGaps = logGapsRef.current.filter(
        (g) => Number.isFinite(g?.startSec) && Number.isFinite(g?.endSec) && g.endSec > g.startSec
      )
      // 재생 위치가 빈 구간 안에 들어왔을 때만 채운다(그 시각을 실제로 보고 있으므로 필요).
      // ⚠️ 백그라운드 선행 채우기(백필)는 일부러 넣지 않는다:
      //    - 사용자가 보지도 않는 구간을 배경에서 받아오면, line 836-837에서 의도적으로 피한
      //      "rosout 전체 다운로드"를 조용히 다시 하게 된다.
      //    - 대신 그 시각으로 이동(또는 그 위치를 재생)하면 그때 채워진다.
      const gapToFill = validGaps.find((g) => center >= g.startSec && center <= g.endSec) || null
      if (insideCoverage && !gapToFill) {
        pendingSeekRef.current = false
        return
      }

      // 커버 구간 밖이다. 여기서 "의도"와 "정책"을 분리해 판단한다.
      // - 의도: pendingSeek(사용자 점프)인지 재생 전진인지 → 위 에폭 신호로 이미 확정.
      // - 정책: 앞으로 벗어난 폭이 이어붙일 만한지(MAX_CATCHUP_SPAN) → 아래 거리 비교.
      const aheadSec = hasCov ? center - covEnd : Number.NaN
      const fillableForward = Number.isFinite(aheadSec) && aheadSec > 0 && aheadSec <= MAX_CATCHUP_SPAN

      let startSec
      let endSec
      let mode
      let skippedGap = null
      if (gapToFill) {
        // 빈 구간 채우기(누적 유지). ⚠️ 반드시 "구간 전체"를 한 번에 받는다.
        //   재생 위치 주변만 조금씩 받으면, 고배속에서 playhead가 한 틱에 (0.1초 × 배속)만큼 튀므로
        //   구간을 연속으로 덮지 못하고 조각만 남긴다. 그 조각은 playhead가 이미 지나가서 다시 못 채운다.
        //   rosout은 희소 토픽(수 Hz)이라 구간 전체를 받아도 한 번의 로드로 충분하다.
        mode = 'fill'
        const MAX_FILL_SPAN = 60 // 병리적으로 넓은 구간만 방어(남으면 다음 기회에 이어서 채움)
        const gapSpan = gapToFill.endSec - gapToFill.startSec
        if (gapSpan <= MAX_FILL_SPAN) {
          startSec = gapToFill.startSec
          endSec = gapToFill.endSec
        } else {
          // 구간이 상한보다 넓다 → 재생 위치를 중심으로 창을 잡아 "보고 있는 지점"을 먼저 덮는다.
          // (앞쪽부터 받으면 정작 사용자가 보고 있는 시각이 이번 로드에 안 들어올 수 있다)
          const half = MAX_FILL_SPAN / 2
          startSec = Math.min(Math.max(gapToFill.startSec, center - half), gapToFill.endSec - MAX_FILL_SPAN)
          endSec = startSec + MAX_FILL_SPAN
        }
      } else if (!hasCov || center < covStart || (pendingSeekRef.current && !fillableForward)) {
        // 최초 로드 / 뒤로 점프 / 멀리 앞으로 점프 → center 주변으로 교체(과거 누적은 맥락이 끊겼으므로 폐기)
        mode = 'seek'
        startSec = Math.max(0, center - SEEK_HALF)
        endSec = Math.min(trEnd, center + SEEK_HALF)
      } else {
        // 여기 오는 경우는 둘.
        // (a) 가까운 앞으로 점프 → 빈 구간을 채우며 누적 유지(기존 동작 보존)
        // (b) 재생이 커버 끝을 앞질렀다(뒤처짐) → 누적 유지. 이게 이번 수정의 핵심:
        //     예전에는 20초 넘게 벌어지면 "점프"로 오판해 모아둔 로그를 통째로 버렸다.
        mode = 'forward'
        const behindSec = aheadSec
        if (behindSec > MAX_CATCHUP_SPAN) {
          // 너무 벌어졌다 → 중간을 건너뛰고 현재 위치 주변만 받는다.
          // 한 번에 거대한 구간을 요청하면 maxMessages 상한에 걸려 오래된 쪽만 채워지고
          // 현재 위치 로그가 계속 늦게 도착하므로(패널이 영구히 뒤처짐) 범위를 제한한다.
          startSec = Math.max(covEnd, center - SEEK_HALF)
          if (startSec > covEnd) skippedGap = { startSec: covEnd, endSec: startSec }
        } else {
          startSec = covEnd
        }
        endSec = Math.min(trEnd, center + PLAY_HALF)
      }
      if (!(endSec > startSec)) return

      rosoutLoadingRef.current = true
      const seq = ++rosoutWindowSeqRef.current

      try {
        const res = await loadJointStatesWindowFromUrl(downloadUrl, {
          topic: rosoutTopic,
          startSec,
          endSec,
          maxMessages: 5000,
          timeDownsampleMs: 0,
          baseAbsStartSec: tr?.absStartSec ?? 0,
          dedupeByTSec: false
        })

        // 파일 전환(seq 무효화)만 폐기 사유 — currentTime 변화로는 폐기하지 않음.
        if (stopped || seq !== rosoutWindowSeqRef.current) return

        const windowSamples = res?.samples || []

        if (mode === 'fill') {
          // 커버 구간은 이미 이 범위를 포함하므로 건드리지 않는다. 샘플만 병합(누적 유지).
          if (windowSamples.length) setRosoutSamples((prev) => mergeForward(prev, windowSamples))
          // 실제로 받은 범위를 기록에서 빼낸다(여러 구간에 걸쳐 있어도 정확히 처리됨).
          const rest = mergeGapRecords(subtractGapRange(logGapsRef.current, startSec, endSec))
          logGapsRef.current = rest
          setLogGaps(rest.length ? rest : null)
          pendingSeekRef.current = false
        } else if (mode === 'forward') {
          // 빈 구간이어도 커버는 전진(같은 구간 재요청 방지)
          accEndCoveredRef.current = endSec
          // 뒤처짐으로 건너뛴 구간이 있으면 기록 → 로그 패널이 "여기 빠졌다"고 표시할 수 있게 한다.
          // (조용한 빈 구간은 "그 시간엔 로그가 없었다"는 오해를 만들어 디버깅에 위험)
          if (skippedGap) {
            const MAX_GAPS = 20
            // 연속으로 건너뛴 구간은 맞닿으므로 병합된다 → 기록 개수 절약 + 구분선도 한 줄로 깔끔해짐
            const next = mergeGapRecords([...logGapsRef.current, skippedGap]).slice(-MAX_GAPS)
            logGapsRef.current = next
            setLogGaps(next.length ? next : null)
          }
          if (windowSamples.length) setRosoutSamples((prev) => mergeForward(prev, windowSamples))
          // 가까운 앞으로 점프를 누적으로 흡수한 경우도 요청은 반영됐으므로 신호 해소
          pendingSeekRef.current = false
        } else {
          // seek: 교체 + 커버 리셋
          coveredStartRef.current = startSec
          accEndCoveredRef.current = endSec
          setRosoutSamples(windowSamples.length ? mergeForward([], windowSamples) : null)
          // 누적을 버렸으므로 이전 미로드 구간 표시도 무의미해진다.
          if (logGapsRef.current.length) {
            logGapsRef.current = []
            setLogGaps(null)
          }
          // 점프 요청을 실제로 반영했으므로 신호 해소(실패 시엔 남겨둬 다음 틱에서 재시도)
          pendingSeekRef.current = false
        }
      } catch (e) {
        console.warn('[ReplayControls] rosout 로드 실패:', e?.message || String(e))
      } finally {
        rosoutLoadingRef.current = false
      }
    }

    const id = setInterval(tick, 120)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [])

  // ─────────────────────────────────────────────
  // 반환 (확장 고려해서 state/actions + 필요한 핸들러도 직접 노출)
  return useMemo(
    () => ({
      // state
      selectedDate,
      logOptions,
      selectedLogId,
      isLoadingList,
      listError,
      isReadingFile,
      readError,
      isPreparingDownload,
      mcapTopics,
      mcapTopicStats,
      mcapTopicSamples,
      mcapRobotDescription,
      jointGroups,
      chartTimelineSamples, // ✅ 차트 전용 풀-타임라인 다운샘플 시리즈
      isChartTimelineLoading, // ✅ 풀-타임라인 로드 진행 여부(차트 로딩 표시용)
      mcapTimeRange,
      isParsingMcap,
      isInitialReady,
      mcapParseError,
      diagnosticEvents, // ✅ 추가: index.jsx에서 받도록
      systemEvents, // ✅ System/Event 로그(diagnostic + system_state 전이)
      textEntries, // ✅ Text 로그 탭용 rosout 데이터
      logGaps, // ✅ 고배속 재생으로 건너뛴 rosout 미로드 구간 [{ startSec, endSec }]
      replayIssues, // ✅ 플레이바 이슈 마커용 실데이터(클러스터)
      replayIssuePoints, // ✅ 이전/다음 이슈 네비게이션용 개별 발생 전수
      issueCounts, // ✅ 플레이바 카운트 라벨용 실제 총계

      // actions/handlers
      setSelectedDate,
      setSelectedLogId,
      onDateChange,
      onLogChange,
      handleFetchListClick, // 첫번째 조회(날짜) + 자동조회
      handleViewSelectedFile, // 두번째 조회(파일 읽기)
      handleDownloadLog, // 다운로드
      handleOpenLichtblick,
      handleVisibleRangeChange,
      allowedDateKeys,
      // (추후 확장용) 읽어온 파일 접근
      selectedFileMetaRef,

      // constants
      EMPTY_OPTION
    }),
    [
      selectedDate,
      logOptions,
      selectedLogId,
      isLoadingList,
      listError,
      isReadingFile,
      readError,
      isPreparingDownload,
      mcapTopics,
      mcapTopicStats,
      mcapTopicSamples,
      mcapRobotDescription,
      jointGroups,
      chartTimelineSamples,
      isChartTimelineLoading,
      mcapTimeRange,
      isParsingMcap,
      isInitialReady,
      mcapParseError,
      diagnosticEvents,
      systemEvents,
      textEntries,
      logGaps,
      replayIssues,
      replayIssuePoints,
      issueCounts,
      onDateChange,
      onLogChange,
      handleFetchListClick,
      handleViewSelectedFile,
      handleDownloadLog,
      handleOpenLichtblick,
      handleVisibleRangeChange,
      allowedDateKeys
    ]
  )
}
