// apps/robot/src/pages/Logreplay/mcap/mcapLoader.js
import { McapIndexedReader } from '@mcap/core'
import { BlobReadable } from '@mcap/browser'
import { tryDecodePayload, buildDecoderForSchema } from './decoder.js'

// 디코더 패키지(패키지 기반, WASM 파일 import 불필요)
import * as fzstd from 'fzstd' // zstd: pure JS (no wasm file import)  [fzstd.decompress(u8)]
import * as lz4ns from 'lz4js' // lz4: browser CJS -> ESM 호환 네임스페이스 임포트

const lz4 = lz4ns && lz4ns.default ? lz4ns.default : lz4ns
const textDecoder = new TextDecoder()

const MAX_GRID_DIMENSION = 8192
const MAX_GRID_CELLS = 16 * 1024 * 1024
const MAX_SCAN_RANGES = 4000
// ===== [Step1] HTTP Range Readable (real impl) =====
// - BlobReadable과 동일한 시그니처: read(offset: bigint, size: bigint), size(): Promise<bigint>
//   [1](https://mcap.dev/docs/typescript/classes/_mcap_browser.BlobReadable)
// - 원격 읽기는 "seek = HTTP range"가 될 수 있으므로, 작은 read 난사 방지를 위해 블록 캐시를 둔다.
//   [2](https://mcap.dev/spec/notes)
class HttpRangeReadable {
  constructor(url, opts = {}) {
    this.url = url
    this._knownSize = typeof opts.knownSize === 'bigint' ? opts.knownSize : null
    this._fetchInit = opts.fetchInit || { mode: 'cors' }
    this._blockSize = Math.max(64 * 1024, Number(opts.blockSizeBytes || 1024 * 1024)) // default 1MB
    this._maxBlocks = Math.max(1, Number(opts.maxCachedBlocks || 3)) // small LRU

    // ✅ 다음 블록 선행 fetch: 기본 OFF.
    //   계측 결과 이 경로가 순수 낭비였다. range 기반 스트리밍에서는 다음에 읽을 위치가
    //   "다음 1MB 블록"이 아니라 재생/탐색 위치에 따라 튀기 때문에, 미리 받은 블록이 쓰이지 않고
    //   LRU에서 밀려나 결국 다시 받게 된다(중복 전송). ReplayControls도 같은 측정 후 껐다.
    //   재활성이 필요하면 생성자에 blockPrefetchNext: true 를 넘긴다.
    this._blockPrefetchNext = opts.blockPrefetchNext === true

    // block cache: key=blockStartBigint.toString() -> Uint8Array
    this._cache = new Map()

    // ✅ [ADD] MCAP 청크 단위 캐시
    this._chunkCache = new Map() // key: offsetString → Uint8Array
    this._chunkCacheBytes = 0
    this._maxChunkCacheBytes = Math.max(
      16 * 1024 * 1024,
      Number(opts.maxChunkCacheBytes || 64 * 1024 * 1024) // 기본 64MB
    )

    // ✅ [ADD] 동시 range fetch 상한(세마포어)
    //   고배속 재생 시 pose/log/overlay 로더가 매 폴링마다 prefetch를 쏘면
    //   fetch()가 수천 개 쌓여 브라우저 커넥션 풀이 고갈(net::ERR_INSUFFICIENT_RESOURCES)되고
    //   pose window 로드가 실패해 로봇 경로가 멈춘다. 활성 fetch를 상한으로 묶고 나머지는 큐에서 대기시킨다.
    this._maxConcurrentFetches = Math.max(1, Number(opts.maxConcurrentFetches || 6))
    this._activeFetches = 0
    this._fetchWaiters = []
  }

  // ✅ [ADD] fetch 슬롯 확보/반납 (경량 세마포어)
  _acquireFetchSlot() {
    if (this._activeFetches < this._maxConcurrentFetches) {
      this._activeFetches++
      return Promise.resolve()
    }
    return new Promise((resolve) => this._fetchWaiters.push(resolve))
  }

  _releaseFetchSlot() {
    const next = this._fetchWaiters.shift()
    if (next)
      next() // 슬롯을 대기자에게 그대로 이양(active 카운트 유지)
    else this._activeFetches = Math.max(0, this._activeFetches - 1)
  }

  async size() {
    if (this._knownSize != null) return this._knownSize

    await this._fetchRange(0n, 0n)
    if (this._knownSize != null) return this._knownSize

    // 최후: 길이 1바이트라도 왔으면 size를 알 수 없으므로 에러
    throw new Error('[HttpRangeReadable] cannot determine remote file size')
  }

  async read(offset, size) {
    // BlobReadable과 동일하게 bigint로 받는 전제
    const off = BigInt(offset)
    const sz = BigInt(size)
    if (sz <= 0n) return new Uint8Array(0)

    // ✅ [ADD] 청크 캐시 우선 조회
    const chunkHit = this._readFromChunkCache(off, sz)
    if (chunkHit) return chunkHit

    // output 버퍼
    const outLen = Number(sz)
    const out = new Uint8Array(outLen)

    const blockSize = BigInt(this._blockSize)
    let written = 0
    let cur = off
    let remain = sz

    while (remain > 0n) {
      const blockStart = (cur / blockSize) * blockSize
      const blockEnd = blockStart + blockSize - 1n

      const block = await this._getBlock(blockStart, blockEnd)
      const inBlockOffset = Number(cur - blockStart)
      const canTake = Math.min(block.length - inBlockOffset, Number(remain))
      if (canTake <= 0) break

      out.set(block.subarray(inBlockOffset, inBlockOffset + canTake), written)

      written += canTake
      cur += BigInt(canTake)
      remain -= BigInt(canTake)
    }

    return written === out.length ? out : out.subarray(0, written)
  }

  async _getBlock(blockStart, blockEnd, { prefetchNext = null } = {}) {
    const key = blockStart.toString()
    if (this._cache.has(key)) {
      const hit = this._cache.get(key)
      this._cache.delete(key)
      this._cache.set(key, hit)
      return hit
    }

    const buf = await this._fetchRange(blockStart, blockEnd)
    this._cache.set(key, buf)

    // 명시 인자 우선, 없으면 인스턴스 기본값(_blockPrefetchNext, 기본 false)
    const doPrefetch = prefetchNext == null ? this._blockPrefetchNext : prefetchNext
    if (doPrefetch) this._prefetchNext(blockStart)
    this._evict()
    return buf
  }

  /** 다음 sequential 블록을 fire-and-forget으로 미리 fetch */
  _prefetchNext(currentBlockStart) {
    const nextStart = currentBlockStart + BigInt(this._blockSize)
    if (this._knownSize != null && nextStart >= this._knownSize) return
    const nextKey = nextStart.toString()
    if (this._cache.has(nextKey)) return
    if (!this._inflight) this._inflight = new Set()
    if (this._inflight.has(nextKey)) return
    this._inflight.add(nextKey)

    const nextEnd =
      this._knownSize != null
        ? nextStart + BigInt(this._blockSize) - 1n < this._knownSize
          ? nextStart + BigInt(this._blockSize) - 1n
          : this._knownSize - 1n
        : nextStart + BigInt(this._blockSize) - 1n

    this._fetchRange(nextStart, nextEnd)
      .then((buf) => {
        if (!this._cache.has(nextKey)) {
          this._cache.set(nextKey, buf)
          this._evict()
        }
      })
      .catch(() => {})
      .finally(() => this._inflight?.delete(nextKey))
  }

  _evict() {
    while (this._cache.size > this._maxBlocks) {
      const firstKey = this._cache.keys().next().value
      this._cache.delete(firstKey)
    }
  }

  // ✅ [ADD] 청크 캐시에서 읽기
  _readFromChunkCache(off, sz) {
    const end = off + sz
    for (const [key, buf] of this._chunkCache) {
      const cOff = BigInt(key)
      const cEnd = cOff + BigInt(buf.byteLength)
      if (off >= cOff && end <= cEnd) {
        const start = Number(off - cOff)
        return buf.subarray(start, start + Number(sz))
      }
    }
    return null
  }

  // ✅ [ADD] MCAP 청크 단위 prefetch (인접 청크 자동 병합)
  async prefetchChunks(chunks) {
    if (!chunks || !chunks.length) return

    const needed = chunks.filter((c) => !this._chunkCache.has(c.offset.toString()))
    if (!needed.length) return

    needed.sort((a, b) => Number(a.offset - b.offset))

    // ✅ 인접 청크 병합: gap 64KB 이내 AND 그룹 총 범위 4MB 이하
    const GAP = 64n * 1024n
    const MAX_GROUP_BYTES = 4n * 1024n * 1024n
    const groups = []
    let cur = {
      start: needed[0].offset,
      end: needed[0].offset + needed[0].length,
      items: [needed[0]]
    }

    for (let i = 1; i < needed.length; i++) {
      const c = needed[i]
      const cEnd = c.offset + c.length
      const newEnd = cEnd > cur.end ? cEnd : cur.end
      const rangeSize = newEnd - cur.start

      if (c.offset <= cur.end + GAP && rangeSize <= MAX_GROUP_BYTES) {
        cur.end = newEnd
        cur.items.push(c)
      } else {
        groups.push(cur)
        cur = { start: c.offset, end: cEnd, items: [c] }
      }
    }
    groups.push(cur)

    // ✅ 그룹 병렬 fetch (순차 → 병렬)
    await Promise.all(
      groups.map(async (g) => {
        const buf = await this._fetchRange(g.start, g.end - 1n)

        for (const c of g.items) {
          const key = c.offset.toString()
          const relStart = Number(c.offset - g.start)
          const relEnd = relStart + Number(c.length)
          const slice = buf.slice(relStart, Math.min(relEnd, buf.length))
          this._chunkCache.set(key, slice)
          this._chunkCacheBytes += slice.byteLength
        }
      })
    )

    this._evictChunkCache()
  }

  // ✅ [ADD] 청크 캐시 용량 제한 (FIFO)
  _evictChunkCache() {
    while (this._chunkCacheBytes > this._maxChunkCacheBytes && this._chunkCache.size > 0) {
      const firstKey = this._chunkCache.keys().next().value
      const buf = this._chunkCache.get(firstKey)
      this._chunkCacheBytes -= buf?.byteLength || 0
      this._chunkCache.delete(firstKey)
    }
  }

  // ✅ [ADD] 윈도우 전환 시 캐시 클리어
  clearChunkCache() {
    this._chunkCache.clear()
    this._chunkCacheBytes = 0
  }
  _parseTotalFromContentRange(h) {
    // Content-Range: bytes 0-0/12345
    if (!h) return null
    const m = String(h).match(/bytes\s+\d+\s*-\s*\d+\s*\/\s*(\d+)/i)
    if (!m) return null
    try {
      const total = BigInt(m[1])
      return total > 0n ? total : null
    } catch {
      return null
    }
  }

  async _fetchRange(start, end) {
    const s = BigInt(start)
    const e = BigInt(end)
    const headers = new Headers(this._fetchInit.headers || {})
    headers.set('Range', `bytes=${s.toString()}-${e.toString()}`)

    // ✅ 동시 fetch 상한 준수 — 슬롯 확보 후 진행, 완료/실패 무관하게 반드시 반납
    await this._acquireFetchSlot()
    try {
      const resp = await fetch(this.url, { ...this._fetchInit, method: 'GET', headers })
      if (!resp.ok) {
        throw new Error(`[HttpRangeReadable] range fetch failed: HTTP ${resp.status}`)
      }

      // total size 힌트 확보
      const cr = resp.headers.get('Content-Range') || resp.headers.get('content-range')
      const total = this._parseTotalFromContentRange(cr)
      if (total != null) this._knownSize = total

      const ab = await resp.arrayBuffer()
      return new Uint8Array(ab)
    } finally {
      this._releaseFetchSlot()
    }
  }
}

/**
 * msg.data -> JS object(or array) 디코드 공통 유틸
 * - decoder(스키마 전용)가 있으면 우선 사용
 * - tryDecodePayload() -> string이면 JSON.parse 시도
 * - 최후: utf8 decode -> JSON.parse(헤더가 {/[ 인 경우만)
 */
async function decodeMsgToObject(msg, ch, schemaResolver, { decoder = null, tryUtf8Json = true } = {}) {
  let obj = null

  // 1) schema decoder 우선
  if (decoder && typeof decoder.decode === 'function') {
    try {
      obj = decoder.decode(msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data))
    } catch {
      obj = null
    }
  }

  // 2) generic decode
  if (!obj) {
    try {
      obj = await tryDecodePayload(msg.data, ch, schemaResolver)
    } catch {
      obj = null
    }
  }

  // 3) string -> JSON.parse
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      // keep as string (caller expects object; will be filtered below)
    }
  }

  // 4) utf8 -> JSON.parse (optional)
  if ((!obj || typeof obj !== 'object') && tryUtf8Json && textDecoder) {
    try {
      const s = textDecoder.decode(msg.data)
      if (s && (s[0] === '{' || s[0] === '[')) {
        try {
          obj = JSON.parse(s)
        } catch {}
      }
    } catch {}
  }

  return obj && typeof obj === 'object' ? obj : null
}

// URL+코덱핸들러 조합별로 IndexedReader를 1회만 오픈하여 공유
const __readerCache = new Map() // key: `${url}::${Object.keys(handlers).sort().join(',')}` -> Promise<{ reader }>

function _handlersKey(handlers) {
  if (!handlers) return 'none'
  const ks = Object.keys(handlers).sort()
  return ks.join(',')
}

/**
 * 같은 URL에 대해 IndexedReader를 재사용한다.
 * - 최초 1회: fetch(blob) + openReaderFromBlob(blob) 수행
 * - 이후: 캐시된 reader/blob 즉시 반환
 */
async function getOrOpenIndexedReaderFromUrl(url, options = {}) {
  const decompressHandlers = await resolveDecompressHandlers(options.decompressHandlers)
  const useHttpRange = !!options.useHttpRange
  const key = `${url}::${_handlersKey(decompressHandlers)}::${useHttpRange ? 'range' : 'blob'}`

  if (!__readerCache.has(key)) {
    const p = (async () => {
      if (useHttpRange) {
        const reader = await openReaderFromUrlRange(url, { decompressHandlers })
        return { reader }
      } else {
        const blob = await fetchBlob(url)
        const reader = await openReaderFromBlob(blob, { decompressHandlers })
        return { reader }
      }
    })()
    p.catch(() => {
      if (__readerCache.get(key) === p) __readerCache.delete(key)
    })
    __readerCache.set(key, p)
  }
  return await __readerCache.get(key)
}

// 채널/스키마 전부 나열
function listAllChannels(reader) {
  const channelsById = reader.channelsById || new Map()
  const schemasById = reader.schemasById || new Map()
  const out = []
  for (const [, ch] of channelsById) {
    const sch = ch?.schemaId != null ? (schemasById.get(ch.schemaId) ?? null) : null
    out.push({
      topic: String(ch?.topic || ''),
      schemaName: String(sch?.name || ''),
      encoding: String(sch?.encoding || '')
    })
  }
  return out
}

// 지도 토픽 후보 고르기: ① 스키마(occupancygrid) ② 토픽명 키워드 ③ 간단 점수(정적맵 선호)
function pickOccupancyGridTopic(reader) {
  // 대표 Grid: 정적 지도
  const candidates = ['/map', '/carto_service/occupancygrid']
  const chosen = findTopicWithMessages(reader, candidates)

  if (!chosen) {
    const topics = listAllChannels(reader).map((c) => c.topic)
    // preferredLower가 있으면 거기에 더 근접한 것 먼저
    console.warn(
      '[Logreplay] OccupancyGrid 토픽을 찾지 못함(또는 메시지 0개). candidates=',
      candidates,
      'available=',
      topics
    )
    // 2) 토픽 이름 키워드로 추려내기
    return null
  }

  // 디버그용 전체 목록
  return chosen
}

// ---- nav_ros_msgs/msg/OccupancyGrid 전용 최소 normalizer ----
// outFlags: 호출자가 "왜 null이 나왔는지"(크기 초과 vs 그 외 손상/누락)를 구분하고 싶을 때 { oversized } 를 채워준다.
function normalizeOccupancyGrid(raw, outFlags) {
  // 1) 메타/치수 추출 (여러 변형 허용)
  const info = raw?.info
  const res = Number(info?.resolution)
  const width = Number(info?.width)
  const height = Number(info?.height)
  if (!(res > 0 && width > 0 && height > 0)) return null

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width > MAX_GRID_DIMENSION ||
    height > MAX_GRID_DIMENSION ||
    width * height > MAX_GRID_CELLS
  ) {
    console.warn('[Logreplay] OccupancyGrid size exceeds limit', { width, height })
    if (outFlags) outFlags.oversized = true
    return null
  }
  // 2) data 추출 (다양한 케이스)
  const originPose = info?.origin || {}
  // (a) { data: <TypedArray|Array> } 래핑
  const originPos = originPose?.position || {}
  // (b) base64 형태
  // atob 기반 디코드 (브라우저)
  const yaw = quatToYaw(originPose?.orientation)

  /* keep null */
  let src = raw?.data
  // (c) ArrayBuffer / DataView / TypedArray / Array
  let u8 = null
  if (src instanceof Uint8Array) u8 = src
  else if (ArrayBuffer.isView(src)) u8 = new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
  else if (Array.isArray(src)) u8 = Uint8Array.from(src)
  // { buffer, byteOffset?, byteLength? } 형태

  // 3) 치수/해상도/데이터 유효성
  if (!u8) return null

  const need = width * height
  if (u8.length < need) return null
  // 길이가 더 길면 앞부분만 사용 (여분 채널/메타가 뒤에 붙는 경우)
  if (u8.length > need) u8 = u8.subarray(0, need)

  // 4) yaw 계산(있으면)

  return {
    frame_id: raw?.header?.frame_id || 'map',
    resolution: res,
    width,
    height,
    origin: { x: +originPos.x || 0, y: +originPos.y || 0, z: +originPos.z || 0, yaw },
    data: u8
  }
}

// ---- sensor_msgs/msg/LaserScan → 센서-로컬 좌표(x,y) 사전 계산 ----
// 스캐너는 로봇 몸체에 고정돼 있으므로(costmap의 base 프레임과 동일 가정), 회전/평행이동은
// 렌더 시점에 그 순간의 로봇 pose로 적용한다. 여기서는 각도별 cos/sin만 한 번 계산해 둔다.
function normalizeLaserScan(raw) {
  const angleMin = Number(raw?.angle_min)
  const angleInc = Number(raw?.angle_increment)
  if (!Number.isFinite(angleMin) || !Number.isFinite(angleInc)) return null

  const rangeMin = Number(raw?.range_min) || 0
  const rangeMax = Number.isFinite(Number(raw?.range_max)) ? Number(raw.range_max) : Infinity

  const src = raw?.ranges
  let arr = null
  if (ArrayBuffer.isView(src)) arr = src
  else if (Array.isArray(src)) arr = src
  if (!arr || !arr.length) return null

  const n = Math.min(arr.length, MAX_SCAN_RANGES)
  const localPts = new Float32Array(n * 2)
  let count = 0
  for (let i = 0; i < n; i++) {
    const r = Number(arr[i])
    if (!Number.isFinite(r) || r < rangeMin || r > rangeMax) continue
    const ang = angleMin + i * angleInc
    localPts[count * 2] = r * Math.cos(ang)
    localPts[count * 2 + 1] = r * Math.sin(ang)
    count++
  }
  if (!count) return null

  return { localPts: count === n ? localPts : localPts.subarray(0, count * 2) }
}

// ===== [ADD] OccupancyGrid → ImageBitmap 사전 변환 =====
// render2d.js의 getOrBuildGridCanvas와 동일한 픽셀 매핑 (Y-flip + 색상)
// → 렌더러에서 ctx.drawImage(grid.imageBitmap, ...) 1회로 완료
async function gridToImageBitmap(grid) {
  if (!grid?.data || !grid.width || !grid.height) return null
  const w = grid.width | 0
  const h = grid.height | 0

  if (w <= 0 || h <= 0 || w > MAX_GRID_DIMENSION || h > MAX_GRID_DIMENSION || w * h > MAX_GRID_CELLS) {
    console.warn('[Logreplay] grid ImageBitmap size exceeds limit', {
      width: w,
      height: h
    })
    return null
  }

  let u8 = grid.data
  if (!(u8 instanceof Uint8Array)) {
    if (ArrayBuffer.isView(u8)) u8 = new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength)
    else if (Array.isArray(u8)) u8 = Uint8Array.from(u8)
    else return null
  }
  if (u8.length < w * h) return null

  const imgData = new ImageData(w, h)
  const px = imgData.data // Uint8ClampedArray [R,G,B,A, ...]

  // ✅ DATA_TOPLEFT Y-flip: getOrBuildGridCanvas와 동일
  for (let y = 0; y < h; y++) {
    const sy = y // source row
    const dy = h - 1 - y // dest row (Y-flip)
    for (let x = 0; x < w; x++) {
      const v = u8[sy * w + x]
      const di = (dy * w + x) << 2

      if (v === 255) {
        // unknown → gray, transparent (기존 동일)
        px[di] = 0x80
        px[di + 1] = 0x80
        px[di + 2] = 0x80
        px[di + 3] = 0
      } else {
        // 0~100 → grayscale (기존 동일)
        const t = Math.max(0, Math.min(100, v)) / 100
        const c = Math.round(255 * (1 - t))
        px[di] = c
        px[di + 1] = c
        px[di + 2] = c
        px[di + 3] = 255
      }
    }
  }

  return createImageBitmap(imgData)
}
// 기대 토픽 후보(소문자) 중 하나로 끝나거나 포함되는 채널을 찾는다.
function findTopicByCandidates(reader, candidatesLower) {
  const topics = listAllChannels(reader).map((c) => c.topic)
  const lowers = topics.map((t) => ({ raw: t, low: t.toLowerCase() }))

  // 1) 완전 일치 우선
  for (const cand of candidatesLower) {
    const hit = lowers.find((x) => x.low === cand)
    if (hit) return hit.raw
  }
  // 2) suffix 매칭 (네임스페이스가 앞에 붙은 경우)
  for (const cand of candidatesLower) {
    const hit = lowers.find((x) => x.low.endsWith(cand))
    if (hit) return hit.raw
  }
  // 3) 부분 포함(안전장치)
  for (const cand of candidatesLower) {
    const hit = lowers.find((x) => x.low.includes(cand))
    if (hit) return hit.raw
  }

  return null
}

// 토픽 존재 여부 + 메시지 카운트(요약 통계, 청크 스캔 없음)로 "읽을 데이터가 있는지" 판별
// - reader.statistics.channelMessageCounts는 mcap 파일을 열 때 이미 파싱된 요약 정보라 추가 스캔이 없다.
function findTopicWithMessages(reader, candidatesLower) {
  const topic = findTopicByCandidates(reader, candidatesLower)
  if (!topic) return null
  const channelsById = reader.channelsById || new Map()
  const ch = [...channelsById.values()].find((c) => c.topic === topic)
  const count = ch ? reader.statistics?.channelMessageCounts?.get(ch.id) : undefined
  if (count != null && count <= 0n) return null // 채널은 있지만 메시지 0개
  return topic
}

function wrapHandler(name, fn) {
  // ⚠️ @mcap/core는 핸들러를 (buffer, decompressedSize)로 호출한다.
  //    WASM 핸들러(@mcap/support)는 두 번째 인자를 실제로 사용하므로 반드시 그대로 전달해야 한다.
  return (buf, decompressedSize) => {
    try {
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
      const out = fn(u8, decompressedSize)
      return out instanceof Uint8Array ? out : new Uint8Array(out)
    } catch (e) {
      console.error(`[Logreplay] 압축 해제 실패 (${name})`, e)
      // 실패를 명확히 알리기 위해 예외를 다시 던진다.
      throw e
    }
  }
}

/** 디컴프 핸들러 기본 세트(fzstd/lz4js) */
function buildDefaultDecompressHandlers() {
  const handlers = {}

  // zstd: fzstd (pure JS)
  if (typeof fzstd?.decompress === 'function') {
    handlers['zstd'] = wrapHandler('zstd(fzstd)', (u8) => fzstd.decompress(u8))
  }

  // lz4: lz4js — 기본은 '프레임'용 decompress.
  // 만약 raw block이면 이 자리에선 실패할 수 있음 → dsa dec 로그로 확인 가능
  if (lz4 && typeof lz4?.decompress === 'function') {
    handlers['lz4'] = wrapHandler('lz4(lz4js)', (u8) => lz4.decompress(u8))
  }

  return handlers
}

/**
 * WASM zstd 압축해제 핸들러(zstddec).
 * 계측 근거: 순수 JS(fzstd)가 60초 재생 중 zstd 690건에 6278ms(입력 58MB, 약 9MB/s)를 메인스레드에서 소비했고,
 *   이게 롱태스크 누적 16.7초의 최대 단일 기여였다. WASM은 같은 일을 훨씬 빠르게 끝낸다.
 * ※ MCAP의 decompressHandlers는 "동기 함수"여야 하므로 압축해제만 워커로 뺄 수 없다.
 *   따라서 메인스레드에 남는 한 더 빠른 동기 구현(WASM)이 유일한 해법이다.
 * ※ @foxglove/wasm-zstd는 쓸 수 없다: glue의 locateFile이 `require("./wasm-zstd.wasm")`로
 *   webpack을 전제해, vite에서 경로가 문자열이 아니게 되어 깨진다("filename.startsWith is not a function").
 */
async function buildWasmZstdHandler() {
  const mod = await import('zstddec')
  const ZSTDDecoder = mod?.ZSTDDecoder || mod?.default?.ZSTDDecoder
  if (typeof ZSTDDecoder !== 'function') throw new Error('zstddec.ZSTDDecoder 없음')

  const decoder = new ZSTDDecoder()
  await decoder.init() // WASM 로딩은 1회만

  return (u8, decompressedSize) => {
    // @mcap/core는 decompressedSize를 bigint로 넘길 수 있어 Number로 변환한다.
    const size = Number(decompressedSize)
    const out = decoder.decode(u8, Number.isFinite(size) && size > 0 ? size : undefined)
    return out instanceof Uint8Array ? out : new Uint8Array(out)
  }
}

// 핸들러는 1회만 만들어 재사용한다(WASM 재로딩 방지 + reader 캐시 키 안정화)
let __decompressHandlersPromise = null

/**
 * 디컴프 핸들러 해결
 * 우선순위:
 *   1) 호출자가 주입한 handlers (options.decompressHandlers)
 *   2) 패키지 기반 기본 핸들러(fzstd/lz4js)
 *
 * ⚠️ @mcap/support.loadDecompressHandlers()는 이 환경에서 쓸 수 없다(2026-09-08 확인):
 *    bz2/lz4/zstd 세 패키지를 Promise.all로 함께 import하는데 wasm-zstd만 설치돼 있어 항상 실패한다.
 *    그래서 zstd만 zstddec(WASM)로 교체하고, lz4는 계측상 사용량이 0이라 JS(lz4js)로 남겨둔다.
 */
async function resolveDecompressHandlers(customHandlers) {
  if (customHandlers && typeof customHandlers === 'object') {
    return customHandlers
  }

  if (!__decompressHandlersPromise) {
    __decompressHandlersPromise = (async () => {
      const handlers = buildDefaultDecompressHandlers()

      // zstd만 WASM으로 교체 시도. 실패하면 위에서 만든 JS(fzstd) 핸들러가 그대로 남는다.
      try {
        const wasmZstd = await buildWasmZstdHandler()
        handlers['zstd'] = wrapHandler('zstd(wasm/zstddec)', wasmZstd)
      } catch (e) {
        console.warn('[Logreplay] WASM zstd(zstddec) 로딩 실패 → JS(fzstd) 폴백. 이유:', e?.message || e)
      }

      if (Object.keys(handlers).length === 0) {
        console.warn('[Logreplay] 사용 가능한 압축 핸들러 없음 (비압축 MCAP만 동작)')
      }
      return handlers
    })()
  }

  return __decompressHandlersPromise
}

async function fetchBlob(url) {
  const resp = await fetch(url, { mode: 'cors' })
  if (!resp.ok) throw new Error(`MCAP fetch failed: HTTP ${resp.status}`)
  return await resp.blob()
}

/**
 * blob으로부터 McapIndexedReader 오픈
 * opts.decompressHandlers: { [codec: string]: (buf: Uint8Array|ArrayBuffer) => Uint8Array }
 */
async function openReaderFromBlob(blob, opts = {}) {
  const decompressHandlers = await resolveDecompressHandlers(opts.decompressHandlers)

  try {
    const reader = await McapIndexedReader.Initialize({
      readable: new BlobReadable(blob),
      decompressHandlers
    })
    return reader
  } catch (e) {
    console.error('[Logreplay] MCAP 리더 초기화 실패:', e)
    throw e
  }
}

// ===== [ADD][Step0] URL 기반 (Range) Reader =====
async function openReaderFromUrlRange(url, opts = {}) {
  const decompressHandlers = await resolveDecompressHandlers(opts.decompressHandlers)

  const readable = new HttpRangeReadable(url, {
    // 블록 1MB: 큰 블록(예: 8MB)은 작은 인덱스/청크 읽기에서 과다 fetch를 유발하므로
    // 청크 크기(~수십~수백KB)에 맞춰 작게 잡아 불필요한 네트워크 전송을 줄인다.
    blockSizeBytes: opts.blockSizeBytes || 1 * 1024 * 1024,
    maxCachedBlocks: opts.maxCachedBlocks || 12
  })

  const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers })

  // ✅ [Step2] loader에서 chunk 기반 prefetch를 호출할 수 있게 연결
  reader.__httpReadable = readable

  return reader
}

function nsToSec(ns) {
  if (typeof ns === 'bigint') return Number(ns) / 1e9
  if (typeof ns === 'number') return ns / 1e9
  return 0
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
// ============================================================
// [ADD] Common helpers for windowed + HTTP range loading
// - pose / rosout / costmap / path / goal_pose 로더에서 재사용
// ============================================================
// ✅ [Step2] chunk index 객체에서 필드명을 안전하게 뽑기(라이브러리/버전 차이 대응)
function _pickChunkField(ci, names) {
  for (const k of names) {
    if (ci && ci[k] != null) return ci[k]
  }
  return null
}

function _toBigIntMaybe(v) {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.floor(v))
  try {
    // 문자열 숫자도 일부 케이스에서 올 수 있어 방어
    if (typeof v === 'string' && v) return BigInt(v)
  } catch {}
  return null
}

// ✅ [ADD] 시간 윈도우에 해당하는 개별 청크 목록 반환
function getChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks = 1 } = {}) {
  const cis = Array.isArray(reader?.chunkIndexes) ? reader.chunkIndexes : []
  if (!cis.length) return []

  const s = _toBigIntMaybe(startTimeNs)
  const e = _toBigIntMaybe(endTimeNs)
  if (s == null || e == null) return []

  let firstIdx = null
  let lastIdx = null

  for (let i = 0; i < cis.length; i++) {
    const ci = cis[i]
    const cs = _toBigIntMaybe(_pickChunkField(ci, ['messageStartTime', 'message_start_time']))
    const ce = _toBigIntMaybe(_pickChunkField(ci, ['messageEndTime', 'message_end_time']))
    if (cs == null || ce == null) continue
    if (ce < s || cs > e) continue
    if (firstIdx == null) firstIdx = i
    lastIdx = i
  }

  if (firstIdx == null) return []

  const lo = Math.max(0, firstIdx - (padChunks | 0))
  const hi = Math.min(cis.length - 1, lastIdx + (padChunks | 0))

  const chunks = []
  for (let i = lo; i <= hi; i++) {
    const ci = cis[i]
    const off = _toBigIntMaybe(
      _pickChunkField(ci, ['chunkStartOffset', 'chunk_start_offset', 'chunkOffset', 'chunk_offset', 'offset'])
    )
    const len = _toBigIntMaybe(_pickChunkField(ci, ['chunkLength', 'chunk_length', 'length']))
    if (off == null || len == null || len <= 0n) continue
    chunks.push({ offset: off, length: len })
  }

  return chunks
}

// ── prefetchChunksForTimeWindow 전체 교체 ──
async function prefetchChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks = 1 } = {}) {
  const http = reader?.__httpReadable
  if (!http || typeof http.prefetchChunks !== 'function') return null

  const chunks = getChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks })
  if (!chunks.length) return null

  await http.prefetchChunks(chunks)

  const totalBytes = chunks.reduce((sum, c) => sum + Number(c.length), 0)
  return { count: chunks.length, chunks, totalBytes }
}

function quatToYaw(q) {
  if (!q || typeof q.w !== 'number') return 0
  const qx = +q.x || 0
  const qy = +q.y || 0
  const qz = +q.z || 0
  const qw = +q.w || 1
  const siny_cosp = 2 * (qw * qz + qx * qy)
  const cosy_cosp = 1 - 2 * (qy * qy + qz * qz)
  return Math.atan2(siny_cosp, cosy_cosp)
}

// ---- Pose2dStamped (geometry_ros_msgs/msg/Pose2dStamped) 전용 최소 추출기 ----
function pickPose2dStamped(obj) {
  // 1) Pose2dStamped: obj.pose
  let p = obj?.pose
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    return { x: +p.x, y: +p.y, z: 0, yaw: Number(p.yaw ?? p.theta ?? 0) || 0 }
  }

  // 2) DWA goal: obj.goal.pose
  p = obj?.goal?.pose
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    return { x: +p.x, y: +p.y, z: 0, yaw: Number(p.yaw ?? p.theta ?? 0) || 0 }
  }

  // 3) fallback: flat object (rare but safe)
  p = obj
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    return { x: +p.x, y: +p.y, z: 0, yaw: Number(p.yaw ?? p.theta ?? 0) || 0 }
  }

  return null
}

// ✅ 범용 Pose 추출기: Pose2dStamped + Odometry + PoseStamped + PoseWithCovarianceStamped 지원
function pickPoseAny(obj) {
  // 1) 기존 Pose2dStamped 우선
  const p2 = pickPose2dStamped(obj)
  if (p2) return p2

  // 2) nav_msgs/Odometry: obj.pose.pose.position / orientation
  const posOdom = obj?.pose?.pose?.position
  const oriOdom = obj?.pose?.pose?.orientation
  if (posOdom && Number.isFinite(posOdom.x) && Number.isFinite(posOdom.y)) {
    return {
      x: +posOdom.x,
      y: +posOdom.y,
      z: Number(posOdom.z) || 0,
      yaw: quatToYaw(oriOdom)
    }
  }

  // 3) geometry_msgs/PoseStamped: obj.pose.position / orientation
  const posPS = obj?.pose?.position
  const oriPS = obj?.pose?.orientation
  if (posPS && Number.isFinite(posPS.x) && Number.isFinite(posPS.y)) {
    return {
      x: +posPS.x,
      y: +posPS.y,
      z: Number(posPS.z) || 0,
      yaw: quatToYaw(oriPS)
    }
  }

  // 4) geometry_msgs/PoseWithCovarianceStamped: obj.pose.pose.position / orientation
  const posPWCS = obj?.pose?.pose?.position
  const oriPWCS = obj?.pose?.pose?.orientation
  if (posPWCS && Number.isFinite(posPWCS.x) && Number.isFinite(posPWCS.y)) {
    return {
      x: +posPWCS.x,
      y: +posPWCS.y,
      z: Number(posPWCS.z) || 0,
      yaw: quatToYaw(oriPWCS)
    }
  }

  // 5) 추가 래핑 케이스: { odom: {...} } / { msg: {...} } / { data: {...} }
  const inner = obj?.odom || obj?.msg || obj?.data
  if (inner && inner !== obj) return pickPoseAny(inner)

  return null
}

function formatLocal(tsSec) {
  const d = new Date(tsSec * 1000)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
function normalizeLevelText(v) {
  const s = String(v ?? '').toUpperCase()
  if (['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(s)) return s
  const n = Number(v ?? 0)
  if (n === 10 || n === 1) return 'DEBUG'
  if (n === 20 || n === 2) return 'INFO'
  if (n === 30 || n === 4) return 'WARN'
  if (n === 40 || n === 8) return 'ERROR'
  if (n === 50 || n === 16) return 'FATAL'
  return 'INFO'
}
// ============================================================
// [ADD] Sparse pose loader — Foxglove 스타일 차트 Overview
// chunk index에서 균등 간격으로 N개만 선택 → 각 chunk에서 1개 pose만 추출
// 전체 chunk 해제 대신 ~100개만 해제 → 20초 → ~2초
// ============================================================
export async function loadPosesSparseFromMcapUrl(url, options = {}) {
  const {
    poseTopic = '/carto_service/trackedpose',
    decompressHandlers,
    numSamples = 100,
    onBatch = null,
    // 소그룹 단위로 prefetch+decode를 파이프라인하는 청크 수(그룹 내부는 병렬)
    prefetchGroup = 4
  } = options

  const { reader } = await getOrOpenIndexedReaderFromUrl(url, {
    decompressHandlers,
    useHttpRange: true
  })

  const candidates = [
    String(poseTopic).toLowerCase(),
    '/aslam_pose',
    '/carto_service/trackedpose',
    '/odom',
    '/lio_odom'
  ]
  const chosen = findTopicWithMessages(reader, candidates)
  if (!chosen) return []

  const channelsById = reader.channelsById || new Map()
  const schemasById = reader.schemasById || new Map()
  const schemaResolver = (id) => (id != null ? (schemasById.get(id) ?? null) : null)

  let decoder = null
  try {
    const ch = [...channelsById.values()].find((c) => c.topic === chosen)
    const sch = ch?.schemaId != null ? schemasById.get(ch.schemaId) : null
    if (sch) decoder = await buildDecoderForSchema(sch)
  } catch {}

  // ── 1) chunk index에서 균등 선택 ──
  const cis = Array.isArray(reader.chunkIndexes) ? reader.chunkIndexes : []
  if (!cis.length) return []

  const baseNs = reader.statistics?.messageStartTime
  if (baseNs == null) return []
  const baseSec = nsToSec(baseNs)

  const stride = Math.max(1, Math.floor(cis.length / numSamples))
  const selected = []
  for (let i = 0; i < cis.length; i += stride) {
    selected.push(cis[i])
  }
  // 마지막 chunk도 포함
  if (selected[selected.length - 1] !== cis[cis.length - 1]) {
    selected.push(cis[cis.length - 1])
  }

  // ── 2+3) 소그룹 단위로 prefetch→decode→표시를 파이프라인 ──
  //   - 전체 청크를 한꺼번에 prefetch(9s 블로킹)하지 않고 소그룹씩 fetch+decode
  //   - 첫 그룹 디코드 직후 onBatch로 부분 차트를 즉시 표시(progressive)
  //   - 청크마다 매크로태스크로 양보 → 동기 압축해제가 맵 paint/상호작용을 굶기지 않음
  const http = reader.__httpReadable
  const out = []
  const GROUP = Math.max(1, Number(prefetchGroup) || 4)

  // 메인스레드 양보(마이크로태스크가 아닌 매크로태스크여야 브라우저 paint가 끼어든다)
  const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0))

  const toPrefetchItem = (ci) => {
    const off = _toBigIntMaybe(
      _pickChunkField(ci, ['chunkStartOffset', 'chunk_start_offset', 'chunkOffset', 'chunk_offset', 'offset'])
    )
    const len = _toBigIntMaybe(_pickChunkField(ci, ['chunkLength', 'chunk_length', 'length']))
    return off != null && len != null ? { offset: off, length: len } : null
  }

  for (let g = 0; g < selected.length; g += GROUP) {
    const group = selected.slice(g, g + GROUP)

    // 소그룹 prefetch(그룹 내부는 병렬) — 한 wave 분량만 가져온다
    // ⚠️ prefetch 실패로 스캔 전체를 중단하면 안 된다.
    //    실제로 ERR_CACHE_OPERATION_NOT_SUPPORTED 등으로 한 그룹이 실패하면서 전체 궤적 스캔이 죽고,
    //    남은 경로가 파일 뒷부분까지 그려지지 않는 문제가 있었다.
    //    prefetch는 "미리 캐시에 담아두는" 최적화일 뿐이므로, 실패하면 아래 readMessages가 직접 읽으면 된다.
    if (http?.prefetchChunks) {
      try {
        const list = group.map(toPrefetchItem).filter(Boolean)
        if (list.length) await http.prefetchChunks(list)
      } catch (e) {
        console.warn('[Logreplay] 궤적 스캔 prefetch 실패(직접 읽기로 계속):', e?.message || e)
      }
    }

    // 그룹 내 각 chunk에서 pose 1개 추출
    for (const ci of group) {
      const startNs = _toBigIntMaybe(_pickChunkField(ci, ['messageStartTime', 'message_start_time']))
      const endNs = _toBigIntMaybe(_pickChunkField(ci, ['messageEndTime', 'message_end_time']))
      if (startNs == null || endNs == null) continue

      try {
        for await (const msg of reader.readMessages({
          topics: [chosen],
          startTime: startNs,
          endTime: endNs
        })) {
          const timeNs = msg.logTime ?? msg.publishTime
          if (timeNs == null) continue
          const tSec = nsToSec(timeNs) - baseSec

          const ch = channelsById.get(msg.channelId)
          const obj = await decodeMsgToObject(msg, ch, schemaResolver, { decoder })
          const pose = pickPoseAny(obj)
          if (pose) {
            out.push({ tSec, x: pose.x, y: pose.y, z: Number(pose.z) || 0, yaw: Number(pose.yaw) || 0 })
            break // ✅ 1개만 추출 후 다음 chunk로
          }
        }
      } catch {}

      // ✅ 청크마다 메인스레드 양보(맵 paint/상호작용 기아 방지)
      await yieldToMain()
    }

    // ✅ 그룹 단위 progressive 표시
    if (onBatch && out.length > 0) {
      onBatch(out.slice())
    }
  }

  out.sort((a, b) => a.tSec - b.tSec)
  if (onBatch) onBatch(out)

  return out
}

// nav_msgs/Path → [{x,y,z}] 추출 (path 편승/로더 공용)
function extractNavPathPoints(obj) {
  const poses = obj?.poses
  if (!Array.isArray(poses)) return []
  const points = []
  for (const it of poses) {
    const pos = it?.pose?.position ?? it?.pose?.pose?.position
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      points.push({ x: +pos.x, y: +pos.y, z: Number(pos.z) || 0 })
    }
  }
  return points
}

// ===== [REPLACE] 기존 export async function loadPosesFromMcapUrl(...) 전체 교체 =====
export async function loadPosesFromMcapUrl(url, options = {}) {
  const {
    poseTopic = '/carto_service/trackedpose',
    decompressHandlers,
    // ✅ Foxglove-style window
    startSec = null, // number | null
    endSec = null, // number | nu
    timeDownsampleMs = null, // t 간격 다운샘플(예: 80ms). null이면 비활성
    // ▼ 편승(piggyback) 스캔: 메인(pose)을 읽는 "같은 청크 스캔"에서 함께 뽑아 콜백으로 넘긴다.
    //   ReplayControls의 extraTopics/onExtraMessage 패턴 이식. 같은 청크 → 추가 fetch/디컴프 없음.
    //   extraTopics: [{ kind, candidates:[...], downsampleMs }], onExtraMessage: (kind, rec) => void
    //   rec는 kind별 정규화 완료본: costmap {tSec,grid} / path {tSec,points} / goal {tSec,x,y,z,yaw}
    extraTopics = [],
    onExtraMessage = null
  } = options

  const isWindow = startSec != null && endSec != null
  const effTimeDownsampleMs = timeDownsampleMs ?? (isWindow ? 20 : 200)

  // 캐시된 reader 사용 (여기서부터 2차,3차 호출도 '바로' 시작)
  const { reader } = await getOrOpenIndexedReaderFromUrl(url, {
    decompressHandlers,
    useHttpRange: true
  })

  const candidates = [
    String(poseTopic).toLowerCase(),
    '/aslam_pose',
    '/carto_service/trackedpose',
    '/odom',
    '/lio_odom'
  ]

  const chosen = findTopicWithMessages(reader, candidates)
  if (!chosen) {
    console.warn('[Logreplay] pose 토픽을 찾지 못함(또는 메시지 0개). candidates=', candidates)
    // ✅ 파일 전체 기준(요약 통계) 판정이라 시간창과 무관하게 확정적이다.
    //    빈 배열([])이 아니라 null을 반환해 "이 파일엔 pose가 없다"를 호출자가 구분할 수 있게 한다.
    return null
  }

  const channelsById = reader.channelsById || new Map()
  const schemasById = reader.schemasById || new Map()
  const schemaResolver = (id) => (id != null ? (schemasById.get(id) ?? null) : null)

  // ✅ [ADD] schema decoder 사전 빌드 (매 메시지 fallback 제거)
  let poseDecoder = null
  try {
    const ch = [...channelsById.values()].find((c) => c.topic === chosen)
    const sch = ch?.schemaId != null ? schemasById.get(ch.schemaId) : null
    if (sch) poseDecoder = await buildDecoderForSchema(sch)
  } catch {
    /* fallback to generic */
  }

  // ▼ 편승 토픽 해석: [{kind,candidates,downsampleMs}] → 실제 존재 채널만 채택
  //   topicName -> { kind, decoder, downsampleMs, lastKept } (다운샘플은 무거운 decode 이전에 적용)
  const extraByTopic = new Map()
  if (typeof onExtraMessage === 'function' && Array.isArray(extraTopics)) {
    for (const ex of extraTopics) {
      if (!ex?.kind || !Array.isArray(ex.candidates)) continue
      const t = findTopicWithMessages(
        reader,
        ex.candidates.map((c) => String(c).toLowerCase())
      )
      if (!t || t === chosen || extraByTopic.has(t)) continue
      let dec = null
      try {
        const ech = [...channelsById.values()].find((c) => c.topic === t)
        const esch = ech?.schemaId != null ? schemasById.get(ech.schemaId) : null
        if (esch) dec = await buildDecoderForSchema(esch)
      } catch {
        /* generic decode fallback */
      }
      extraByTopic.set(t, {
        kind: ex.kind,
        decoder: dec,
        downsampleMs: Number(ex.downsampleMs) || 0,
        lastKept: -Infinity
      })
    }
  }

  const out = []
  let lastTs = -Infinity

  const pickXYYawDeep = pickPoseAny

  let total = 0

  try {
    const secToNs = (s) => BigInt(Math.floor(Number(s) * 1e9))

    // ✅ MCAP epoch 기준 시작점
    const baseNs = reader.statistics?.messageStartTime ?? undefined
    const baseSec = baseNs != null ? nsToSec(baseNs) : 0

    const readArgs = {
      // 편승 토픽이 있으면 같은 스캔에 포함(같은 청크 → 추가 fetch/디컴프 없음)
      topics: extraByTopic.size ? [chosen, ...extraByTopic.keys()] : [chosen],

      startTime: baseNs != null && startSec != null ? baseNs + secToNs(startSec) : undefined,
      endTime: baseNs != null && endSec != null ? baseNs + secToNs(endSec) : undefined
    }

    // ✅ [Step2] chunkIndexes 기반으로 해당 시간 구간 chunk들을 먼저 가져와 캐시에 적재
    // - 같은 시간대 클릭 시 결과가 매번 달라지는 현상(부분 chunk read/경계) 완화 + Range 폭발 감소
    if (readArgs.startTime != null && readArgs.endTime != null) {
      try {
        await prefetchChunksForTimeWindow(reader, readArgs.startTime, readArgs.endTime, { padChunks: 1 })
      } catch (e) {
        console.warn('[Logreplay] pose prefetch 실패:', e?.message || e)
      }
    }

    for await (const msg of reader.readMessages(readArgs)) {
      total++

      const timeNs = msg.logTime != null ? msg.logTime : msg.publishTime
      if (timeNs == null) continue
      const tSec = nsToSec(timeNs) - baseSec

      const ch = channelsById.get(msg.channelId)

      // ▼ 편승 토픽: 메인과 별개로 (kind별 다운샘플 후) 정규화해 콜백. decode는 다운샘플 이후에만.
      const ex = ch?.topic ? extraByTopic.get(ch.topic) : null
      if (ex) {
        if (!Number.isFinite(tSec)) continue
        if (ex.downsampleMs > 0 && ex.lastKept > -Infinity && (tSec - ex.lastKept) * 1000 < ex.downsampleMs) {
          if ((total & 0x3ff) === 0) await Promise.resolve()
          continue
        }
        ex.lastKept = tSec
        const exObj = await decodeMsgToObject(msg, ch, schemaResolver, { decoder: ex.decoder, tryUtf8Json: true })
        if (exObj) {
          let rec = null
          if (ex.kind === 'costmap') {
            const grid = normalizeOccupancyGrid(exObj)
            if (grid) rec = { tSec, grid }
          } else if (ex.kind === 'path') {
            const points = extractNavPathPoints(exObj)
            if (points.length) rec = { tSec, points }
          } else if (ex.kind === 'goal' || ex.kind === 'odomRaw') {
            const p = pickPoseAny(exObj)
            if (p) rec = { tSec, x: p.x, y: p.y, z: Number(p.z) || 0, yaw: Number(p.yaw) || 0 }
          } else if (ex.kind === 'lidar') {
            const scan = normalizeLaserScan(exObj)
            if (scan) rec = { tSec, localPts: scan.localPts }
          }
          if (rec) onExtraMessage(ex.kind, rec)
        }
        if ((total & 0x3ff) === 0) await Promise.resolve()
        continue
      }

      // ✅ 시간 기반 다운샘플 (결정적: 같은 입력 → 항상 같은 출력)
      if (effTimeDownsampleMs > 0 && Number.isFinite(tSec)) {
        if (lastTs > -Infinity && (tSec - lastTs) * 1000 < effTimeDownsampleMs) {
          continue
        } else {
          lastTs = tSec
        }
      }

      const obj = await decodeMsgToObject(msg, ch, schemaResolver, { decoder: poseDecoder, tryUtf8Json: true })

      const pose = obj ? pickXYYawDeep(obj) : null
      if (pose && Number.isFinite(tSec)) {
        const rec = { tSec, x: pose.x, y: pose.y, z: Number(pose.z) || 0, yaw: Number(pose.yaw) || 0 }
        out.push(rec)
      }

      // ✅ UI 프리즈 방지: 1024 메시지마다 양보
      if ((total & 0x3ff) === 0) await Promise.resolve()
    }
  } catch (e) {
    console.error('[Logreplay] pose 읽기 실패:', e)
  }

  // ✅ 안정화: 시간순 정렬 + 같은 tSec 중복 제거(마지막 값을 채택)
  out.sort((a, b) => a.tSec - b.tSec)
  return dedupeSortedByTSec(out)
}

export async function loadOccupancyGridFromMcapUrl(
  url,
  {
    decompressHandlers,
    // 선택 전략: 점수 기반이므로 기본은 'score'로 두되, 'first'도 지원
    select = 'first', // 'first' | 'latest'
    maxMessages = 1200,
    onTimeBounds, // ✅ [ADD] (bounds) => void
    onOversized // ✅ [ADD] grid 토픽은 있지만 전부 크기 제한 초과로 폐기된 경우 1회 호출 → UI가 "없음"과 "크기 초과"를 구분해 안내할 수 있게 함
  } = {}
) {
  // ✅ Step1: map(OccupancyGrid)만 HTTP Range로 테스트
  const { reader } = await getOrOpenIndexedReaderFromUrl(url, {
    decompressHandlers,
    useHttpRange: true
  })
  const cis = Array.isArray(reader?.chunkIndexes) ? reader.chunkIndexes : []
  // ===============================
  // ✅ Step 2-A: 전체 타임라인 bounds 계산 (Foxglove 스타일)
  // 1) Statistics.messageStartTime/messageEndTime 우선
  // 2) 없거나 이상하면 chunkIndexes의 messageStartTime/messageEndTime로 fallback
  // ===============================
  const pickBounds = () => {
    const st = reader?.statistics
    // @mcap/core Statistics: messageStartTime/messageEndTime [1](https://mcap.dev/docs/typescript/types/_mcap_core.McapTypes.Statistics)
    const s0 = st?.messageStartTime
    const e0 = st?.messageEndTime

    // (A) statistics 후보
    if (s0 != null && e0 != null) {
      // 혹시 뒤집힌/이상값이면(Studio가 chunk time을 쓰는 케이스 존재)
      if (typeof s0 === 'bigint' && typeof e0 === 'bigint' && e0 > s0) {
        return { startNs: s0, endNs: e0, source: 'statistics' }
      }
    }

    // (B) chunkIndexes fallback (ChunkIndex에 messageStartTime/messageEndTime 존재)
    if (Array.isArray(cis) && cis.length) {
      let min = null
      let max = null
      for (const ci of cis) {
        const cs = ci?.messageStartTime ?? ci?.message_start_time
        const ce = ci?.messageEndTime ?? ci?.message_end_time
        if (typeof cs === 'bigint') min = min == null ? cs : cs < min ? cs : min
        if (typeof ce === 'bigint') max = max == null ? ce : ce > max ? ce : max
      }
      if (min != null && max != null && max > min) {
        return { startNs: min, endNs: max, source: 'chunkIndexes' }
      }
    }
    return null
  }

  const bounds = pickBounds()
  if (bounds) {
    const statStartSec = Number(bounds.startNs) / 1e9
    const statEndSec = Number(bounds.endNs) / 1e9
    const durationSec = Math.max(0, statEndSec - statStartSec)
    if (typeof onTimeBounds === 'function') {
      onTimeBounds({ ...bounds, startSec: statStartSec, endSec: statEndSec, durationSec })
    }
  }

  const chosenTopic = pickOccupancyGridTopic(reader)
  if (!chosenTopic) {
    console.warn('[Logreplay] OccupancyGrid 토픽 없음. available:', listAllChannels(reader))
    return null
  }

  const channelsById = reader.channelsById || new Map()
  const schemasById = reader.schemasById || new Map()
  const schemaResolver = (id) => (id != null ? (schemasById.get(id) ?? null) : null)

  // 스키마 디코더 준비
  let gridDecoder = null
  try {
    const ch = [...channelsById.values()].find((c) => c.topic === chosenTopic)
    const sch = ch?.schemaId != null ? schemasById.get(ch.schemaId) : null
    if (sch) {
      gridDecoder = await buildDecoderForSchema(sch)
    }
  } catch (e) {
    console.warn('[Logreplay] grid 스키마 디코더 생성 실패(generic 디코드로 폴백):', e)
  }

  let anyOversized = false
  function normalizeGrid(obj) {
    if (!obj) return null
    const flags = {}
    const grid = normalizeOccupancyGrid(obj, flags)
    if (flags.oversized) anyOversized = true
    return grid
  }

  // 토픽 성격

  // 후보 누적: 빈/손상 프레임 제외, 나머지는 점수 산정
  let firstValid = null
  let lastValid = null
  let count = 0

  try {
    for await (const msg of reader.readMessages({ topics: [chosenTopic] })) {
      const ch = channelsById.get(msg.channelId)
      const obj = await decodeMsgToObject(msg, ch, schemaResolver, { decoder: gridDecoder, tryUtf8Json: true })
      const grid = normalizeGrid(obj)
      count++

      if (grid) {
        // 타임스탬프(초) & 최근성
        if (!firstValid) firstValid = grid
        lastValid = grid
        if (select === 'first') break
      }

      if (count >= maxMessages) break
    }
  } catch (e) {
    console.warn('[Logreplay] grid 읽기 실패:', e)
  }
  // 최종 선택: best -> firstValid -> null
  const resultGrid = select === 'latest' ? (lastValid ?? firstValid) : (firstValid ?? lastValid)
  if (!resultGrid) {
    console.warn('[Logreplay] 유효한 OccupancyGrid 없음:', chosenTopic)
    // ✅ 메시지가 있었지만 전부 크기 제한에 걸려 폐기된 경우: "토픽/데이터 없음"과는 다른 상태이므로 별도로 알림
    if (anyOversized && typeof onOversized === 'function') onOversized()
  }

  // ✅ ImageBitmap 사전 생성 → 렌더러에서 drawImage 1회로 완료
  if (resultGrid) {
    try {
      resultGrid.imageBitmap = await gridToImageBitmap(resultGrid)
    } catch (e) {
      console.warn('[Logreplay] grid ImageBitmap 생성 실패(raw 폴백):', e)
    }
  }

  return resultGrid
}

export async function loadRosoutFromMcapUrl(url, options = {}) {
  const {
    logTopic = '/rosout',
    decompressHandlers,
    onBatch,
    batchSize = 200,
    maxLines = 50000,
    startSec = null,
    endSec = null
  } = options

  const { reader } = await getOrOpenIndexedReaderFromUrl(url, {
    decompressHandlers,
    useHttpRange: true
  })

  const candidates = [String(logTopic).toLowerCase(), '/rosout', '/rosout_agg']
  const chosen = findTopicWithMessages(reader, candidates)
  if (!chosen) return { found: false, entries: [], topic: null }

  const channelsById = reader.channelsById || new Map()
  const schemasById = reader.schemasById || new Map()
  const schemaResolver = (id) => (id != null ? (schemasById.get(id) ?? null) : null)

  let decoder = null
  try {
    const ch = [...channelsById.values()].find((c) => c.topic === chosen)
    const sch = ch?.schemaId != null ? schemasById.get(ch.schemaId) : null
    if (sch) decoder = await buildDecoderForSchema(sch)
  } catch {}

  const baseNs = reader.statistics?.messageStartTime ?? undefined
  const baseSec = baseNs != null ? nsToSec(baseNs) : 0
  const secToNs = (s) => BigInt(Math.floor(Number(s) * 1e9))
  const isWindow = startSec != null && endSec != null

  const readArgs = {
    topics: [chosen],
    startTime: isWindow && baseNs != null ? baseNs + secToNs(startSec) : undefined,
    endTime: isWindow && baseNs != null ? baseNs + secToNs(endSec) : undefined
  }

  // ✅ chunk prefetch (windowed 또는 full-range)
  try {
    const pStart = readArgs.startTime ?? reader.statistics?.messageStartTime
    const pEnd = readArgs.endTime ?? reader.statistics?.messageEndTime
    if (pStart != null && pEnd != null) {
      await prefetchChunksForTimeWindow(reader, pStart, pEnd, { padChunks: 1 })
    }
  } catch (e) {
    console.warn('[Logreplay] rosout prefetch 실패:', e)
  }

  const entries = []
  let batch = []
  let count = 0

  try {
    for await (const msg of reader.readMessages(readArgs)) {
      const timeNs = msg.logTime ?? msg.publishTime
      if (timeNs == null) continue
      const epochMs = Math.round(Number(timeNs) / 1e6)
      const tSec = nsToSec(timeNs) - baseSec

      const ch = channelsById.get(msg.channelId)
      const obj = await decodeMsgToObject(msg, ch, schemaResolver, {
        decoder,
        tryUtf8Json: true
      })

      let level = 'INFO',
        text = ''
      if (obj && typeof obj === 'object') {
        level = normalizeLevelText(obj.level ?? obj.severity ?? 'INFO')
        const name = obj.name || obj.node_name || ''
        const msgText = obj.msg || obj.message || ''
        text = `[${level}] ${formatLocal(nsToSec(timeNs))} ${name}: ${msgText}`
      } else {
        try {
          text = textDecoder.decode(msg.data)
        } catch {
          text = `(binary ${msg.data?.byteLength ?? 0}B)`
        }
      }

      entries.push({ tSec, epochMs, level, text })
      batch.push(entries[entries.length - 1])
      count++

      if (onBatch && batch.length >= batchSize) {
        onBatch(batch)
        batch = []
      }
      if ((count & 0x3ff) === 0) await Promise.resolve()
      if (count >= maxLines) break
    }
  } catch (e) {
    console.warn('[Logreplay] rosout 읽기 실패:', e)
  }

  if (onBatch && batch.length) onBatch(batch)
  entries.sort((a, b) => a.tSec - b.tSec)
  return { found: entries.length > 0, entries, topic: chosen }
}
