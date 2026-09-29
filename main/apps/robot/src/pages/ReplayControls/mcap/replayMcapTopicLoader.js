import { McapIndexedReader } from '@mcap/core'

// Logreplay 디코더 유틸
import { tryDecodePayload, buildDecoderForSchema } from '../../Logreplay/mcap/decoder.js'

// 패키지 기반 디컴프
import * as fzstd from 'fzstd'
import * as lz4ns from 'lz4js'

const lz4 = lz4ns && lz4ns.default ? lz4ns.default : lz4ns
const textDecoder = new TextDecoder()

// ============================================================
// A 기반 전체 교체 버전
// - B의 외부 API 유지
// - 내부는 A 스타일로 재구성
// ============================================================

// ===== HTTP Range Readable (A 스타일 확장형) =====
class HttpRangeReadable {
  constructor(url, opts = {}) {
    this.url = url
    this._knownSize = typeof opts.knownSize === 'bigint' ? opts.knownSize : null
    this._fetchInit = opts.fetchInit || { mode: 'cors' }

    this._blockSize = Math.max(64 * 1024, Number(opts.blockSizeBytes || 8 * 1024 * 1024))
    this._maxBlocks = Math.max(1, Number(opts.maxCachedBlocks || 12))

    // [①-b] 블록 경로 _prefetchNext(다음 1MB 자동 당김) 기본 OFF.
    // 측정상 거의 순수 낭비(fired 102 / wasted 92MB)였고, 재생/탐색의 prefetch 이점은
    // 블록경로가 아니라 chunk 단위 prefetchChunks(chunkCache)에서 나오므로 영향 없음.
    // 순방향 연속 블록읽기에서 다시 켜고 싶으면 blockPrefetchNext:true 로 생성.
    this._blockPrefetchNext = opts.blockPrefetchNext === true

    this._cache = new Map()
    this._inflight = new Set()

    // chunk cache
    this._chunkCache = new Map() // key: offsetString -> Uint8Array
    this._chunkCacheBytes = 0
    this._maxChunkCacheBytes = Math.max(16 * 1024 * 1024, Number(opts.maxChunkCacheBytes || 64 * 1024 * 1024))
  }

  async size() {
    if (this._knownSize != null) return this._knownSize

    await this._fetchRange(0n, 0n)
    if (this._knownSize != null) return this._knownSize

    throw new Error('[ReplayMCAP][HttpRangeReadable] cannot determine remote file size')
  }

  async read(offset, size) {
    const off = BigInt(offset)
    const sz = BigInt(size)
    if (sz <= 0n) return new Uint8Array(0)

    // chunk cache hit 우선
    const chunkHit = this._readFromChunkCache(off, sz)
    if (chunkHit) return chunkHit

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

  async _getBlock(blockStart, blockEnd, { prefetchNext } = {}) {
    // [①-b] 명시 인자 우선, 없으면 인스턴스 기본값(_blockPrefetchNext, 기본 false)
    const doPrefetch = prefetchNext == null ? this._blockPrefetchNext : prefetchNext
    const key = blockStart.toString()
    if (this._cache.has(key)) {
      const hit = this._cache.get(key)
      this._cache.delete(key)
      this._cache.set(key, hit)
      return hit
    }

    const buf = await this._fetchRange(blockStart, blockEnd)
    this._cache.set(key, buf)

    if (doPrefetch) this._prefetchNext(blockStart)
    this._evict()
    return buf
  }

  _prefetchNext(currentBlockStart) {
    const nextStart = currentBlockStart + BigInt(this._blockSize)
    if (this._knownSize != null && nextStart >= this._knownSize) return

    const nextKey = nextStart.toString()
    if (this._cache.has(nextKey) || this._inflight.has(nextKey)) return
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
      .finally(() => this._inflight.delete(nextKey))
  }

  _evict() {
    while (this._cache.size > this._maxBlocks) {
      const firstKey = this._cache.keys().next().value
      this._cache.delete(firstKey)
    }
  }

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

  async prefetchChunks(chunks) {
    if (!chunks || !chunks.length) return

    const needed = chunks.filter((c) => !this._chunkCache.has(c.offset.toString()))
    if (!needed.length) return

    needed.sort((a, b) => Number(a.offset - b.offset))

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

  _evictChunkCache() {
    while (this._chunkCacheBytes > this._maxChunkCacheBytes && this._chunkCache.size > 0) {
      const firstKey = this._chunkCache.keys().next().value
      const buf = this._chunkCache.get(firstKey)
      this._chunkCacheBytes -= buf?.byteLength || 0
      this._chunkCache.delete(firstKey)
    }
  }

  clearChunkCache() {
    this._chunkCache.clear()
    this._chunkCacheBytes = 0
  }

  _parseTotalFromContentRange(h) {
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

    const resp = await fetch(this.url, {
      ...this._fetchInit,
      method: 'GET',
      headers
    })
    if (!resp.ok) {
      throw new Error(`[ReplayMCAP][HttpRangeReadable] range fetch failed: HTTP ${resp.status}`)
    }

    const cr = resp.headers.get('Content-Range') || resp.headers.get('content-range')
    const total = this._parseTotalFromContentRange(cr)
    if (total != null) this._knownSize = total

    const ab = await resp.arrayBuffer()
    return new Uint8Array(ab)
  }
}

// ===== decompress helpers =====
function wrapHandler(name, fn) {
  return (buf) => {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    try {
      const out = fn(u8)
      return out instanceof Uint8Array ? out : new Uint8Array(out)
    } catch (e) {
      console.error(`[ReplayControls] 압축 해제 실패 (${name})`, e)
      throw e
    }
  }
}

function buildDefaultDecompressHandlers() {
  const handlers = {}

  if (typeof fzstd?.decompress === 'function') {
    handlers.zstd = wrapHandler('zstd(fzstd)', (u8) => fzstd.decompress(u8))
  }
  if (lz4 && typeof lz4?.decompress === 'function') {
    handlers.lz4 = wrapHandler('lz4(lz4js)', (u8) => lz4.decompress(u8))
  }

  return handlers
}

async function resolveDecompressHandlers(customHandlers) {
  if (customHandlers && typeof customHandlers === 'object') {
    return customHandlers
  }
  return buildDefaultDecompressHandlers()
}

// ===== common utils =====
function nsToSec(ns) {
  if (typeof ns === 'bigint') return Number(ns) / 1e9
  if (typeof ns === 'number') return ns / 1e9
  return NaN
}

function secToNsBigIntAbs(absSec) {
  return BigInt(Math.floor(Number(absSec) * 1e9))
}

// Map 키가 bigint/number 섞여도 안전하게 get
function getFromMapFlexible(map, id) {
  if (!map || typeof map.get !== 'function') return undefined
  if (map.has(id)) return map.get(id)

  try {
    const bid = typeof id === 'bigint' ? id : BigInt(id)
    if (map.has(bid)) return map.get(bid)
  } catch {}

  try {
    const nid = typeof id === 'number' ? id : Number(id)
    if (!Number.isNaN(nid) && map.has(nid)) return map.get(nid)
  } catch {}

  return undefined
}

// schema 레코드를 buildDecoderForSchema에 맞게 "텍스트화"
function schemaToTextual(schemaRec) {
  if (!schemaRec) return null

  let dataText = null
  if (typeof schemaRec.data === 'string') dataText = schemaRec.data
  else if (schemaRec.data instanceof Uint8Array) dataText = textDecoder.decode(schemaRec.data)
  else if (schemaRec.data?.buffer) dataText = textDecoder.decode(new Uint8Array(schemaRec.data.buffer))
  if (!dataText) return null

  let enc = String(schemaRec.encoding || '').toLowerCase()
  if (enc === 'ros2') enc = 'ros2msg'
  if (enc === 'ros1') enc = 'ros1msg'
  if (enc === 'ros2idl') enc = 'ros2idl'

  return {
    id: Number(schemaRec.id),
    name: schemaRec.name,
    encoding: enc,
    data: dataText
  }
}

// ===== decoder cache =====
const __decoderCache = new Map()

function getSchemaCacheKey(schemaRec) {
  if (!schemaRec) return null
  return `${schemaRec.id}::${schemaRec.name || ''}::${schemaRec.encoding || ''}`
}

async function getOrBuildDecoderForChannel(channel, schemasById) {
  const schemaRec = channel?.schemaId != null ? getFromMapFlexible(schemasById, channel.schemaId) : null
  if (!schemaRec) return null

  const key = getSchemaCacheKey(schemaRec)
  if (!key) return null

  if (!__decoderCache.has(key)) {
    const textual = schemaToTextual(schemaRec)
    const p = textual ? buildDecoderForSchema(textual).catch(() => null) : Promise.resolve(null)
    __decoderCache.set(key, p)
  }

  return await __decoderCache.get(key)
}

async function decodeMessageToObject({ dataU8, channel, schemasById, decoder = null, tryUtf8Json = true }) {
  let obj = null

  // 1) schema decoder 우선
  const dec = decoder || (await getOrBuildDecoderForChannel(channel, schemasById))
  if (dec && typeof dec.decode === 'function') {
    try {
      obj = dec.decode(dataU8)
    } catch {
      obj = null
    }
  }

  // 2) generic decode
  if (!obj) {
    try {
      const schemaResolver = (id) => (id != null ? (getFromMapFlexible(schemasById, id) ?? null) : null)
      obj = await tryDecodePayload(dataU8, channel, schemaResolver)

      if (typeof obj === 'string') {
        try {
          const s = obj.trim()
          if (s && (s[0] === '{' || s[0] === '[')) obj = JSON.parse(s)
        } catch {}
      }
    } catch {
      obj = null
    }
  }

  // 3) utf8 -> JSON
  if ((!obj || typeof obj !== 'object') && tryUtf8Json) {
    try {
      const s = textDecoder.decode(dataU8)
      if (s && (s[0] === '{' || s[0] === '[')) {
        try {
          obj = JSON.parse(s)
        } catch {}
      }
    } catch {}
  }

  return obj && typeof obj === 'object' ? obj : null
}

// ===== chunk helpers =====
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
    if (typeof v === 'string' && v) return BigInt(v)
  } catch {}
  return null
}

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
    // [①-a] 청크 뒤 MessageIndex 레코드까지 prefetch 범위에 포함(selectTargetWindows와 동일).
    // 안 하면 리더가 인덱스를 chunkCache miss → 1MB 블록 경로로 산발 fetch(측정: block miss 103.72MB).
    const miLen = _toBigIntMaybe(_pickChunkField(ci, ['messageIndexLength', 'message_index_length'])) ?? 0n
    chunks.push({ offset: off, length: len + (miLen > 0n ? miLen : 0n) })
  }

  return chunks
}

async function prefetchChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks = 1 } = {}) {
  const http = reader?.__httpReadable
  if (!http || typeof http.prefetchChunks !== 'function') return null

  const chunks = getChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks })
  if (!chunks.length) return null

  await http.prefetchChunks(chunks)
  return chunks
}

// [③] 재생 선행 prefetch: 디코드/샘플 없이 [startSec,endSec] 구간 청크만 chunkCache로 미리 적재.
// - 전진 재생 중 다음 윈도우를 미리 받아두면 playhead 도착 시 window 로드가 캐시 히트 → 네트워크 대기 없이 부드러움.
// - prefetchChunks가 이미 캐시에 있는 청크는 자동 skip → 추가 바이트 ≈0(어차피 재생하며 읽을 청크).
// - fire-and-forget로 호출(반환 await 불필요). reader 캐시 재사용이라 추가 reader open 비용 없음.
export async function prefetchJointWindowAhead(
  url,
  { startSec, endSec, baseAbsStartSec = null, decompressHandlers } = {}
) {
  if (!url || typeof url !== 'string' || !(Number(endSec) > Number(startSec))) return
  let reader
  try {
    ;({ reader } = await getOrOpenIndexedReaderFromUrl(url, { decompressHandlers }))
  } catch {
    return
  }
  const absBaseSec = Number.isFinite(baseAbsStartSec) ? baseAbsStartSec : nsToSec(reader?.statistics?.messageStartTime)
  if (!Number.isFinite(absBaseSec)) return
  const startTimeNs = secToNsBigIntAbs(absBaseSec + Number(startSec))
  const endTimeNs = secToNsBigIntAbs(absBaseSec + Number(endSec))
  try {
    await prefetchChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks: 1 })
  } catch {
    /* prefetch 실패는 무해(다음 window 로드가 직접 fetch) */
  }
}

// ===== reader cache =====
const __readerCache = new Map() // key -> Promise<{ reader }>

function _handlersKey(handlers) {
  if (!handlers) return 'none'
  return Object.keys(handlers).sort().join(',')
}

async function openReaderFromUrlRange(url, opts = {}) {
  const decompressHandlers = await resolveDecompressHandlers(opts.decompressHandlers)

  const readable = new HttpRangeReadable(url, {
    blockSizeBytes: opts.blockSizeBytes || 1 * 1024 * 1024,
    maxCachedBlocks: opts.maxCachedBlocks || 12,
    maxChunkCacheBytes: opts.maxChunkCacheBytes || 64 * 1024 * 1024
  })

  const reader = await McapIndexedReader.Initialize({
    readable,
    decompressHandlers
  })

  reader.__httpReadable = readable
  return reader
}

export async function getOrOpenIndexedReaderFromUrl(url, options = {}) {
  const decompressHandlers = await resolveDecompressHandlers(options.decompressHandlers)
  const key = `${url}::${_handlersKey(decompressHandlers)}::range`

  if (!__readerCache.has(key)) {
    const p = (async () => {
      const reader = await openReaderFromUrlRange(url, { decompressHandlers })
      return { reader }
    })()
    p.catch(() => {
      if (__readerCache.get(key) === p) __readerCache.delete(key)
    })
    __readerCache.set(key, p)
  }

  return await __readerCache.get(key)
}

export function clearReplayMcapReaderCache() {
  __readerCache.clear()
  __decoderCache.clear()
}

// ===== topic utils =====
function getTopicCatalog(reader) {
  const channelsById = reader?.channelsById || new Map()
  const schemasById = reader?.schemasById || new Map()

  const topics = []
  for (const [, ch] of channelsById) {
    const sch = ch?.schemaId != null ? (getFromMapFlexible(schemasById, ch.schemaId) ?? null) : null
    topics.push({
      topic: String(ch?.topic || ''),
      schemaName: String(sch?.name || ''),
      schemaEncoding: String(sch?.encoding || ''),
      messageEncoding: String(ch?.messageEncoding || ''),
      schemaId: ch?.schemaId != null ? Number(ch.schemaId) : null
    })
  }
  topics.sort((a, b) => a.topic.localeCompare(b.topic))
  return topics
}

function getTimeRangeFromReader(reader) {
  const stat = reader?.statistics
  const cis = Array.isArray(reader?.chunkIndexes) ? reader.chunkIndexes : []

  let startNs = stat?.messageStartTime ?? null
  let endNs = stat?.messageEndTime ?? null

  if (!(startNs != null && endNs != null && endNs > startNs) && cis.length) {
    let min = null
    let max = null
    for (const ci of cis) {
      const cs = _toBigIntMaybe(_pickChunkField(ci, ['messageStartTime', 'message_start_time']))
      const ce = _toBigIntMaybe(_pickChunkField(ci, ['messageEndTime', 'message_end_time']))
      if (cs != null) min = min == null ? cs : cs < min ? cs : min
      if (ce != null) max = max == null ? ce : ce > max ? ce : max
    }
    if (min != null && max != null && max > min) {
      startNs = min
      endNs = max
    }
  }

  if (startNs == null || endNs == null || endNs <= startNs) return null

  const absStartSec = nsToSec(startNs)
  const absEndSec = nsToSec(endNs)
  const duration = Math.max(0, absEndSec - absStartSec)

  return {
    startSec: 0,
    endSec: duration,
    absStartSec,
    absEndSec,
    startNs,
    endNs
  }
}

// /base/robot_description은 이 로봇에서 참고용으로 쓰지 않기로 확인됨(2026-09) → /robot_description만 사용.
const ROBOT_DESCRIPTION_TOPIC_PRIORITY = ['/robot_description']

async function loadRobotDescription(reader) {
  const channelsById = reader?.channelsById || new Map()
  const schemasById = reader?.schemasById || new Map()

  const byTopic = new Map() // topic -> robotDescription string(토픽별 첫 메시지만, URDF는 latched 1회성)

  try {
    for await (const entry of reader.readMessages({ topics: ROBOT_DESCRIPTION_TOPIC_PRIORITY })) {
      const channel =
        entry?.channel || (entry?.channelId != null ? getFromMapFlexible(channelsById, entry.channelId) : null) || null

      const topic = channel?.topic
      if (!topic || byTopic.has(topic)) continue

      const data = entry?.message?.data ?? entry?.data
      if (!data) continue

      const dataU8 = data instanceof Uint8Array ? data : new Uint8Array(data)
      const decoder = await getOrBuildDecoderForChannel(channel, schemasById)

      const obj = await decodeMessageToObject({
        dataU8,
        channel,
        schemasById,
        decoder
      })

      if (obj?.data) byTopic.set(topic, obj.data)

      if (ROBOT_DESCRIPTION_TOPIC_PRIORITY.every((t) => byTopic.has(t))) break
    }
  } catch (e) {
    console.warn('[ReplayControls] URDF(robot_description) 읽기 실패:', e)
  }

  for (const topic of ROBOT_DESCRIPTION_TOPIC_PRIORITY) {
    if (byTopic.has(topic)) return byTopic.get(topic)
  }
  return null
}

function getAvailableTopicsSet(reader) {
  const channelsById = reader?.channelsById || new Map()
  const set = new Set()
  for (const [, ch] of channelsById) {
    if (ch?.topic) set.add(String(ch.topic))
  }
  return set
}

// ===== sparse 청크 선택 =====
// 전체 청크를 스캔하면 리더가 청크별 전체 레코드를 순회하므로 비용이 청크 수에 비례한다.
// → 시간순 균등 간격으로 maxChunks개만 골라 그 시간 윈도우만 스캔한다.
// 반환: windows(ns 문자열, 워커 전송 안전) + ranges(prefetch용 bigint offset/length)
export function selectTargetWindows(reader, topicsToScanLen, maxChunks = 50) {
  const allCis = Array.isArray(reader?.chunkIndexes) ? reader.chunkIndexes : []
  const N = topicsToScanLen > 0 ? Math.min(maxChunks, allCis.length) : 0
  if (N <= 0) return { windows: [], ranges: [] }

  const sorted = [...allCis].sort((a, b) => {
    const aS = _toBigIntMaybe(_pickChunkField(a, ['messageStartTime', 'message_start_time'])) ?? 0n
    const bS = _toBigIntMaybe(_pickChunkField(b, ['messageStartTime', 'message_start_time'])) ?? 0n
    return aS < bS ? -1 : aS > bS ? 1 : 0
  })

  const targetCis =
    sorted.length <= N
      ? sorted
      : Array.from({ length: N }, (_, i) => {
          const idx = Math.round((i * (sorted.length - 1)) / (N - 1))
          return sorted[Math.min(idx, sorted.length - 1)]
        })

  const windows = []
  const ranges = []
  for (const ci of targetCis) {
    const csNs = _toBigIntMaybe(_pickChunkField(ci, ['messageStartTime', 'message_start_time']))
    const ceNs = _toBigIntMaybe(_pickChunkField(ci, ['messageEndTime', 'message_end_time']))
    if (csNs == null || ceNs == null) continue
    windows.push({ csNs: csNs.toString(), ceNs: ceNs.toString() })

    const off = _toBigIntMaybe(
      _pickChunkField(ci, ['chunkStartOffset', 'chunk_start_offset', 'chunkOffset', 'chunk_offset', 'offset'])
    )
    const len = _toBigIntMaybe(_pickChunkField(ci, ['chunkLength', 'chunk_length', 'length']))
    // 청크 뒤에 붙는 MessageIndex 레코드까지 prefetch에 포함한다.
    // (안 하면 리더가 스캔 중 인덱스를 8MB 블록 경로로 산발 fetch → 거대한 네트워크 amplification)
    const miLen = _toBigIntMaybe(_pickChunkField(ci, ['messageIndexLength', 'message_index_length'])) ?? 0n
    if (off != null && len != null && len > 0n) {
      ranges.push({ offset: off, length: len + (miLen > 0n ? miLen : 0n) })
    }
  }
  return { windows, ranges }
}

export function resolveTopicsToScan(reader, sampleTopics) {
  const wantAll = !sampleTopics || sampleTopics.length === 0
  if (wantAll) return getTopicCatalog(reader).map((t) => t.topic)
  const available = getAvailableTopicsSet(reader)
  return [...new Set(sampleTopics)].filter((tp) => available.has(tp))
}

// 주어진 시간 윈도우들만 스캔 → 토픽별 버킷 샘플 + 원시 통계(count/firstSec/lastSec).
// 워커/메인 양쪽에서 공용으로 쓰는 순수 함수 (prefetch/카탈로그/URDF는 호출 측 책임).
export async function scanWindowsFromReader(
  reader,
  {
    topicsToScan = [],
    windows = [],
    baseAbsStartSec = null,
    duration = 0,
    samplePerTopic = 120,
    maxScanMessages = 60000
  } = {}
) {
  const channelsById = reader?.channelsById || new Map()
  const schemasById = reader?.schemasById || new Map()
  const bucketCount = Math.max(1, Number(samplePerTopic) || 120)

  const perTopic = {}
  for (const topic of topicsToScan) {
    const ch = [...channelsById.values()].find((c) => c?.topic === topic)
    perTopic[topic] = {
      decoder: ch ? await getOrBuildDecoderForChannel(ch, schemasById) : null,
      bucketMap: new Map(),
      fallback: [],
      count: 0,
      firstSec: null,
      lastSec: null,
      scanned: 0
    }
  }

  const _processEntry = async (entry) => {
    const channel =
      entry?.channel || (entry?.channelId != null ? getFromMapFlexible(channelsById, entry.channelId) : null) || null
    const entryTopic = channel?.topic
    if (!entryTopic || !perTopic[entryTopic]) return

    const state = perTopic[entryTopic]
    state.scanned++
    if (state.scanned > maxScanMessages) return

    const tNs = entry?.logTime ?? entry?.publishTime ?? entry?.message?.logTime ?? entry?.message?.publishTime ?? null
    const tSecAbs = nsToSec(tNs)
    if (!Number.isFinite(tSecAbs)) return

    state.count++
    if (state.firstSec == null || tSecAbs < state.firstSec) state.firstSec = tSecAbs
    if (state.lastSec == null || tSecAbs > state.lastSec) state.lastSec = tSecAbs

    const data = entry?.message?.data ?? entry?.data
    if (!data) return
    const dataU8 = data instanceof Uint8Array ? data : new Uint8Array(data)

    if (baseAbsStartSec != null && duration > 0) {
      const relSec = tSecAbs - baseAbsStartSec
      const r = Math.min(0.999999, Math.max(0, relSec / duration))
      const b = Math.floor(r * bucketCount)
      if (state.bucketMap.has(b)) return
      const obj = await decodeMessageToObject({ dataU8, channel, schemasById, decoder: state.decoder })
      if (!obj) return
      state.bucketMap.set(b, { tSec: relSec, msg: obj })
    } else {
      if (state.fallback.length >= bucketCount) return
      const obj = await decodeMessageToObject({ dataU8, channel, schemasById, decoder: state.decoder })
      if (!obj) return
      state.fallback.push({ tSec: tSecAbs, msg: obj })
    }
  }

  for (const w of windows) {
    const csNs = _toBigIntMaybe(w?.csNs)
    const ceNs = _toBigIntMaybe(w?.ceNs)
    if (csNs == null || ceNs == null) continue
    for await (const entry of reader.readMessages({ topics: topicsToScan, startTime: csNs, endTime: ceNs })) {
      await _processEntry(entry)
    }
    await Promise.resolve() // 이벤트 루프 양보
  }

  const stats = {}
  const samples = {}
  const useBuckets = baseAbsStartSec != null && duration > 0
  for (const topic of topicsToScan) {
    const state = perTopic[topic]
    stats[topic] = { count: state.count, firstSec: state.firstSec, lastSec: state.lastSec }
    samples[topic] = useBuckets ? Array.from(state.bucketMap.values()).sort((a, b) => a.tSec - b.tSec) : state.fallback
  }
  return { stats, samples }
}

// hz 계산을 포함해 stats를 최종화 (단일/병렬 공용)
function finalizeStats(rawStats, topicsToScan) {
  const stats = {}
  for (const topic of topicsToScan) {
    const s = rawStats?.[topic] || { count: 0, firstSec: null, lastSec: null }
    const dt = s.firstSec != null && s.lastSec != null ? s.lastSec - s.firstSec : 0
    stats[topic] = { count: s.count, firstSec: s.firstSec, lastSec: s.lastSec, hz: dt > 0 ? (s.count - 1) / dt : null }
  }
  return stats
}

// MCAP Statistics 레코드(channelMessageCounts)에서 "모든 토픽"의 전체 메시지 수를 추출한다.
// - 스캔 없이 메타데이터만으로 즉시 계산되므로 비용이 사실상 0이다.
// - 스캔에서 제외된 토픽(/joint_states, /tf, /tf_static, /robot_description 등)도 포함된다.
// - hz는 파일 전체 구간 기준 근사값(= (count-1)/duration). 실제 스캔된 토픽은 이후 측정 hz로 덮어쓴다.
// - Statistics 레코드가 없는 파일이면 빈 객체를 반환 → 기존 스캔 stats로 자연 폴백.
function buildBaselineStatsFromStatistics(reader, timeRange) {
  const counts = reader?.statistics?.channelMessageCounts
  const channelsById = reader?.channelsById || new Map()
  const out = {}
  if (!counts || typeof counts.forEach !== 'function') return out

  const duration = Number(timeRange?.endSec) || 0
  for (const [chId, cntRaw] of counts) {
    const ch = getFromMapFlexible(channelsById, chId)
    const topic = ch?.topic
    if (!topic) continue
    const count = Number(cntRaw)
    if (!Number.isFinite(count)) continue
    out[String(topic)] = {
      count,
      firstSec: null,
      lastSec: null,
      hz: duration > 0 && count > 1 ? (count - 1) / duration : null
    }
  }
  return out
}

// Statistics 기반 baseline(전체 count) + 스캔 결과(측정 hz)를 병합한다.
// - count: Statistics의 전체 총계 우선 (스캔은 sparse 윈도우만 보므로 부분 집계).
// - hz   : 스캔 측정값 우선, 없으면 baseline 근사값.
function mergeTopicStats(baselineStats, scannedStats) {
  const stats = {}
  const topics = new Set([...Object.keys(baselineStats || {}), ...Object.keys(scannedStats || {})])
  for (const t of topics) {
    const b = baselineStats?.[t]
    const s = scannedStats?.[t]
    stats[t] = {
      count: b?.count ?? s?.count ?? 0,
      firstSec: s?.firstSec ?? null,
      lastSec: s?.lastSec ?? null,
      hz: s?.hz != null ? s.hz : (b?.hz ?? null)
    }
  }
  return stats
}

const DEFAULT_SAMPLE_TOPICS = [
  '/joint_states',
  // diagnostic/actuator는 구(hmc_ros2_control)·신(ethercat_hardware_interface) 이름 모두 포함
  '/hmc_ros2_control/diagnostic',
  '/ethercat_hardware_interface/diagnostic',
  '/hmc_ros2_control/actuator_states',
  '/ethercat_hardware_interface/actuator_states',
  '/tracking_controller/joint',
  '/battery/battery_status'
]

// ===== core collector (단일 스레드: 폴백/워커 미사용 경로) =====
async function collectTopicsAndSamplesFromReader(reader, options = {}) {
  const { sampleTopics = DEFAULT_SAMPLE_TOPICS, samplePerTopic = 300, maxScanMessages = 300000 } = options

  const topics = getTopicCatalog(reader)
  const timeRange = getTimeRangeFromReader(reader)
  const baseAbsStartSec = timeRange?.absStartSec ?? null
  const duration = timeRange?.endSec ?? 0

  const robotDescription = await loadRobotDescription(reader)
  // URDF는 즉시 준비되므로, 나머지 스캔을 기다리지 않고 콜백 (로봇 뷰어 조기 렌더)
  if (typeof options.onRobotDescription === 'function') {
    try {
      options.onRobotDescription(robotDescription)
    } catch (e) {
      console.warn('[ReplayControls] onRobotDescription 콜백 실패:', e?.message || String(e))
    }
  }

  // 토픽 카탈로그(reader 채널) + Statistics 기반 count/hz는 window 스캔 없이 즉시 계산 가능.
  // → 느린 스캔을 기다리지 않고 조기 콜백으로 ROS Topics 목록을 먼저 표시(스캔 지연/실패와 무관).
  const baselineStats = buildBaselineStatsFromStatistics(reader, timeRange)
  if (typeof options.onTopicsAndStats === 'function') {
    try {
      options.onTopicsAndStats({ topics, stats: baselineStats, timeRange })
    } catch (e) {
      console.warn('[ReplayControls] onTopicsAndStats 콜백 실패:', e?.message || String(e))
    }
  }

  const topicsToScan = resolveTopicsToScan(reader, sampleTopics)
  // rosout 계열(텍스트 로그)은 네임스페이스가 붙어 이름이 정확히 '/rosout'이 아닐 수 있으므로,
  // 카탈로그에서 'rosout'을 포함하는 토픽을 자동으로 스캔 대상에 추가한다.
  // ⚠️ 단, sampleTopics에 rosout이 포함된 경우에만. rosout은 텍스트 로그라 양이 매우 많아
  //    메인 스캔에 끼면 diagnostic(System 로그)까지 늦어진다. rosout은 currentTime ±구간
  //    lazy load(useReplayControlsLogic)로 분리했으므로, sampleTopics에서 빼면 여기서도 제외된다.
  const wantRosout = (sampleTopics || []).some((t) => /rosout/i.test(String(t || '')))
  if (wantRosout) {
    for (const t of topics) {
      if (/rosout/i.test(t.topic) && !topicsToScan.includes(t.topic)) topicsToScan.push(t.topic)
    }
  }
  const { windows, ranges } = selectTargetWindows(reader, topicsToScan.length, 50)

  await prefetchRangesIntoReader(reader, ranges)

  const raw = await scanWindowsFromReader(reader, {
    topicsToScan,
    windows,
    baseAbsStartSec,
    duration,
    samplePerTopic,
    maxScanMessages
  })

  // 측정 hz는 스캔 결과를 우선 적용한다(baseline은 위에서 이미 계산).
  const scannedStats = finalizeStats(raw.stats, topicsToScan)

  return {
    topics,
    stats: mergeTopicStats(baselineStats, scannedStats),
    samples: raw.samples,
    timeRange,
    robotDescription
  }
}

// prefetch (네트워크 워밍업): 대상 청크 바이트를 chunkCache에 미리 적재
export async function prefetchRangesIntoReader(reader, ranges) {
  const http = reader?.__httpReadable
  if (!http || !Array.isArray(ranges) || ranges.length === 0) return
  const totalBytes = ranges.reduce((s, c) => s + Number(c.length), 0)
  if (totalBytes > http._maxChunkCacheBytes) {
    http._maxChunkCacheBytes = Math.min(512 * 1024 * 1024, Math.ceil(totalBytes * 1.1))
  }
  try {
    await http.prefetchChunks(ranges)
  } catch (e) {
    console.warn('[ReplayControls] 청크 prefetch 실패(재생은 계속됨):', e?.message)
  }
}

// ============================================================
// 신규 API (URL + HTTP Range 기반)
// ============================================================
export async function loadMcapTopicsAndSamplesFromUrl(url, options = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid MCAP url')
  }

  const { reader } = await getOrOpenIndexedReaderFromUrl(url, {
    decompressHandlers: options.decompressHandlers
  })

  return await collectTopicsAndSamplesFromReader(reader, options)
}

// 풀-스캔용 청크 계획: [startTimeNs,endTimeNs] 구간에서 topic이 포함된 청크만(가능하면) 시간순으로.
// - messageIndexOffsets(청크별 채널 인덱스)가 있으면 topic 채널 포함 청크만 선별 → 희소 토픽(rosout/system_state)은
//   해당 청크만 읽어 대폭 빨라짐.
// - 없으면 구간 내 전체 청크(여전히 정확한 byte range만 fetch → 8MB 블록 과다fetch 회피).
// 반환: 정렬된 [{offset,length,startNs,endNs}] 또는 null(chunkIndex/채널 없음 → 호출부가 기존 readMessages 폴백).
function planTopicChunks(reader, topic, startTimeNs, endTimeNs, maxChunks = 0) {
  const cis = Array.isArray(reader?.chunkIndexes) ? reader.chunkIndexes : []
  if (!cis.length) return null

  const channelsById = reader?.channelsById || new Map()
  const channelIds = new Set()
  for (const [id, ch] of channelsById) {
    if (ch?.topic === topic) channelIds.add(Number(id))
  }
  if (channelIds.size === 0) return null // 토픽 채널 없음 → 폴백(빈 스캔이라 저렴)

  const s = _toBigIntMaybe(startTimeNs)
  const e = _toBigIntMaybe(endTimeNs)

  const sel = []
  for (const ci of cis) {
    const cs = _toBigIntMaybe(_pickChunkField(ci, ['messageStartTime', 'message_start_time']))
    const ce = _toBigIntMaybe(_pickChunkField(ci, ['messageEndTime', 'message_end_time']))
    if (cs == null || ce == null) continue
    if (s != null && ce < s) continue
    if (e != null && cs > e) continue

    // topic 포함 여부(messageIndexOffsets)로 희소 토픽 청크만 선별. 정보 없으면 구간 내 전체 포함.
    const mio = _pickChunkField(ci, ['messageIndexOffsets', 'message_index_offsets'])
    if (mio) {
      let has = false
      if (mio instanceof Map) {
        for (const cid of channelIds) {
          if (mio.has(cid) || mio.has(BigInt(cid))) {
            has = true
            break
          }
        }
      } else if (typeof mio === 'object') {
        for (const cid of channelIds) {
          if (mio[cid] != null) {
            has = true
            break
          }
        }
      } else {
        has = true // 형태 불명 → 보수적으로 포함
      }
      if (!has) continue
    }

    const off = _toBigIntMaybe(
      _pickChunkField(ci, ['chunkStartOffset', 'chunk_start_offset', 'chunkOffset', 'chunk_offset', 'offset'])
    )
    const len = _toBigIntMaybe(_pickChunkField(ci, ['chunkLength', 'chunk_length', 'length']))
    if (off == null || len == null || len <= 0n) continue
    // [①-a] 청크 뒤 MessageIndex까지 prefetch 범위에 포함(selectTargetWindows와 동일).
    // readMessages가 인덱스를 chunkCache에서 읽도록 해 1MB 블록경로 누수(더블페치)를 차단.
    const miLen = _toBigIntMaybe(_pickChunkField(ci, ['messageIndexLength', 'message_index_length'])) ?? 0n
    sel.push({ offset: off, length: len + (miLen > 0n ? miLen : 0n), startNs: cs, endNs: ce })
  }

  if (!sel.length) return null
  sel.sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0))

  // 청크 서브샘플링: maxChunks 초과 시 전 구간을 균등 stride로 솎아냄(차트처럼 전체 개요만 필요할 때).
  // - 받는 바이트 = sel.length/maxChunks 배 감소 → 그만큼 빠름. 단 미선택 청크 구간은 차트에 공백(보간).
  // - 첫/마지막 청크는 항상 포함해 시작·끝 커버.
  if (maxChunks > 0 && sel.length > maxChunks) {
    const stride = Math.ceil(sel.length / maxChunks)
    const strided = []
    for (let i = 0; i < sel.length; i += stride) strided.push(sel[i])
    const last = sel[sel.length - 1]
    if (strided[strided.length - 1] !== last) strided.push(last)
    return strided
  }

  return sel
}

// ============================================================
// 신규: /joint_states 현재 구간 window 로더
// - A 스타일 chunk prefetch + decoder cache 적용
// - 반환 형식은 기존과 동일: { topic, samples: [{ tSec, msg }] }
// ============================================================
export async function loadJointStatesWindowFromUrl(url, options = {}) {
  const {
    topic = '/joint_states',
    startSec = 0,
    endSec = 3,
    maxMessages = 800,
    timeDownsampleMs = 0,
    baseAbsStartSec = null,
    skipPrefetch = false, // true: 순차 HTTP로 첫 메시지 탐색 (전체 prefetch 생략)
    dedupeByTSec = true, // 동일 tSec 샘플 제거. joint_states는 타임스탬프당 1개라 true.
    //                      rosout 등 같은 시각 다중 메시지가 있는 토픽은 false로 호출(로그 유실 방지).
    maxChunks = 0, // >0이면 풀-스캔 시 청크를 균등 stride로 솎아 읽음(차트 개요용 — 속도↑, 공백 보간)
    decompressHandlers,
    // 편승 스캔(옵션): 메인 토픽을 읽는 "같은 청크"에서 함께 읽어 콜백으로 넘길 추가 토픽 목록.
    //   메인 토픽의 다운샘플/limit/stop과 무관하게 raw로 전달 → 별도 다운로드/디컴프 없이 희소 토픽 확보.
    //   샘플 누적·정렬 등 소비는 전적으로 onExtraMessage(호출자) 책임. onExtraMessage 없으면 완전 비활성.
    extraTopics = [],
    onExtraMessage = null
  } = options

  if (!url || typeof url !== 'string') {
    throw new Error('Invalid MCAP url')
  }

  const { reader } = await getOrOpenIndexedReaderFromUrl(url, {
    decompressHandlers
  })

  const channelsById = reader?.channelsById || new Map()
  const schemasById = reader?.schemasById || new Map()

  const absBaseSec = (() => {
    if (Number.isFinite(baseAbsStartSec)) return baseAbsStartSec
    const st = nsToSec(reader?.statistics?.messageStartTime)
    if (Number.isFinite(st)) return st
    // chunk index fallback: Statistics record 없는 파일 대응
    const cis = Array.isArray(reader?.chunkIndexes) ? reader.chunkIndexes : []
    let min = null
    for (const ci of cis) {
      const cs = _toBigIntMaybe(_pickChunkField(ci, ['messageStartTime', 'message_start_time']))
      if (cs != null) min = min == null ? cs : cs < min ? cs : min
    }
    return min != null ? nsToSec(min) : NaN
  })()

  if (!Number.isFinite(absBaseSec)) {
    throw new Error('[ReplayControls][joint window] cannot determine baseAbsStartSec')
  }

  const startTimeNs = secToNsBigIntAbs(absBaseSec + Number(startSec || 0))
  const endTimeNs = secToNsBigIntAbs(absBaseSec + Number(endSec || 0))

  // A 스타일 prefetch (skipPrefetch=true면 순차 HTTP 탐색 — 첫 메시지 탐색 시 사용)
  if (!skipPrefetch) {
    try {
      await prefetchChunksForTimeWindow(reader, startTimeNs, endTimeNs, { padChunks: 1 })
    } catch (e) {
      console.warn('[ReplayControls] joint_states 윈도우 prefetch 실패:', e)
    }
  }

  const topicChannel = [...channelsById.values()].find((c) => c?.topic === topic)
  const topicDecoder = topicChannel ? await getOrBuildDecoderForChannel(topicChannel, schemasById) : null

  // 편승 스캔 셋업: 콜백이 있을 때만, 메인 토픽과 다른 토픽만 스캔 대상에 추가.
  //   디코더는 decodeMessageToObject 내부 캐시(__decoderCache)에 맡김 → 여기서 미리 해석하지 않음.
  const extraSet = new Set(
    typeof onExtraMessage === 'function' ? (extraTopics || []).filter((t) => t && t !== topic) : []
  )
  // readMessages 토픽 목록: 편승 토픽이 있으면 같은 스캔에 포함(같은 청크 → 추가 fetch 없음).
  const readTopics = extraSet.size > 0 ? [topic, ...extraSet] : [topic]

  const out = []
  let lastKeptT = -Infinity
  let count = 0

  // 메시지 1건 처리(다운샘플/디코드/수집). 반환 'stop'이면 maxMessages 도달 → 호출 루프 종료.
  const processEntry = async (entry) => {
    const channel = entry?.channelId != null ? getFromMapFlexible(channelsById, entry.channelId) : null
    const tNs = entry?.logTime ?? entry?.publishTime ?? null

    const tSecAbs = nsToSec(tNs)
    if (!Number.isFinite(tSecAbs)) return

    const relSec = tSecAbs - absBaseSec
    if (!Number.isFinite(relSec)) return

    // 편승 토픽은 메인의 다운샘플/limit/stop과 분리해 raw로 콜백에 전달(디코더는 내부 캐시 사용).
    const entryTopic = channel?.topic
    if (extraSet.size > 0 && entryTopic && entryTopic !== topic && extraSet.has(entryTopic)) {
      const exData = entry?.message?.data ?? entry?.data
      if (!exData) return
      const exU8 = exData instanceof Uint8Array ? exData : new Uint8Array(exData)
      const exObj = await decodeMessageToObject({ dataU8: exU8, channel, schemasById })
      if (exObj) onExtraMessage(entryTopic, { tSec: relSec, msg: exObj })
      return
    }

    if (timeDownsampleMs > 0 && Number.isFinite(lastKeptT) && (relSec - lastKeptT) * 1000 < timeDownsampleMs) {
      return
    }
    lastKeptT = relSec

    const data = entry?.message?.data ?? entry?.data
    if (!data) return
    const dataU8 = data instanceof Uint8Array ? data : new Uint8Array(data)
    const obj = await decodeMessageToObject({
      dataU8,
      channel,
      schemasById,
      decoder: topicDecoder
    })
    if (!obj) return

    out.push({ tSec: relSec, msg: obj })
    count++

    if ((count & 0x1ff) === 0) await Promise.resolve()
    if (count >= maxMessages) return 'stop'
  }

  // 풀-스캔(skipPrefetch): 청크 단위 "정확 prefetch" 파이프라인.
  // - 8MB 블록 읽기의 과다fetch(파일~3배) 대신, 청크 byte range만 그룹 단위로 정확히 받음.
  // - 토픽 포함 청크만(planTopicChunks) → rosout/system_state 같은 희소 토픽은 해당 청크만 읽어 큰 폭 빠름.
  // - 그룹별 prefetch→readMessages→다음 그룹(chunkCache 64MB가 자동 evict → 메모리 bounded).
  // chunkIndex/채널 없으면 chunkPlan=null → 기존 readMessages 폴백(동작 불변).
  const chunkPlan = skipPrefetch ? planTopicChunks(reader, topic, startTimeNs, endTimeNs, maxChunks) : null

  if (chunkPlan && chunkPlan.length) {
    const http = reader?.__httpReadable
    // 그룹을 크게(12청크/48MB) → prefetchChunks가 Promise.all로 더 많이 동시 fetch(브라우저 한도 ~6까지)
    // + 디코드 사이 멈춤 횟수↓ → 네트워크 활용도↑. (연속 청크 system_state에 특히 효과)
    const GROUP = 12
    const MAX_GROUP_BYTES = 48 * 1024 * 1024
    // stride(차트 maxChunks)면 청크 사이 갭이 있으므로 청크별로 읽어야 함(그룹 범위로 읽으면 갭 청크 over-fetch).
    // 비-stride(rosout/system_state)는 연속이라 그룹 범위 1회로 읽어 readMessages 호출 수↓(오버헤드 감소).
    const perChunk = maxChunks > 0
    let prevEndNs = null
    let gi = 0
    let stopped = false

    while (gi < chunkPlan.length && !stopped) {
      // 그룹 구성(최대 GROUP개 / MAX_GROUP_BYTES 이하)
      const group = []
      let bytes = 0
      while (
        gi < chunkPlan.length &&
        group.length < GROUP &&
        (group.length === 0 || bytes + Number(chunkPlan[gi].length) <= MAX_GROUP_BYTES)
      ) {
        bytes += Number(chunkPlan[gi].length)
        group.push(chunkPlan[gi])
        gi++
      }

      // 그룹 청크의 정확한 byte range만 prefetch(chunkCache로 들어감 → readMessages가 캐시에서 읽음)
      if (http && typeof http.prefetchChunks === 'function') {
        try {
          await http.prefetchChunks(group.map((g) => ({ offset: g.offset, length: g.length })))
        } catch {}
      }

      // 읽을 (시간범위) 목록 구성.
      // - perChunk(stride): 청크별 범위. 그룹 전체로 읽으면 stride로 건너뛴 청크까지 포함돼 over-fetch됨.
      // - 비-stride: 연속 청크라 그룹 전체를 1회 범위로 읽어 readMessages 호출 수↓.
      // prevEndNs+1 하한 클램프 → 인접/겹치는 범위의 경계 중복 방지.
      const ranges = perChunk
        ? group.map((ch) => ({ startNs: ch.startNs, endNs: ch.endNs }))
        : [{ startNs: group[0].startNs, endNs: group[group.length - 1].endNs }]

      for (const r of ranges) {
        let gStart = prevEndNs != null && prevEndNs + 1n > r.startNs ? prevEndNs + 1n : r.startNs
        if (gStart < startTimeNs) gStart = startTimeNs
        let gEnd = r.endNs
        if (gEnd > endTimeNs) gEnd = endTimeNs
        prevEndNs = r.endNs
        if (gEnd < gStart) continue

        for await (const entry of reader.readMessages({ topics: readTopics, startTime: gStart, endTime: gEnd })) {
          if ((await processEntry(entry)) === 'stop') {
            stopped = true
            break
          }
        }
        if (stopped) break
      }
      await Promise.resolve() // 그룹 사이 메인 스레드 양보
    }
  } else {
    for await (const entry of reader.readMessages({
      topics: readTopics,
      startTime: startTimeNs,
      endTime: endTimeNs
    })) {
      if ((await processEntry(entry)) === 'stop') break
    }
  }

  out.sort((a, b) => (a.tSec ?? 0) - (b.tSec ?? 0))
  if (dedupeByTSec) {
    for (let i = out.length - 2; i >= 0; i--) {
      if ((out[i]?.tSec ?? 0) === (out[i + 1]?.tSec ?? 0)) {
        out.splice(i, 1)
      }
    }
  }

  // timeRange는 reader 메타데이터/청크 인덱스 기반이라 디컴프 없이 즉시 계산됨.
  // → Phase 1 직후 mcapTimeRange를 설정해 재생/탐색이 Phase 2를 기다리지 않게 함.
  return {
    topic,
    samples: out,
    timeRange: getTimeRangeFromReader(reader)
  }
}
