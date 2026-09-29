// components/RobotVisualization.jsx
import React, { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'

import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

import { fileApis } from '@/apis'
import { fetchWithRetry } from '@/utils/fetchWithRetry'
import { pickNearestJointStateSample, applyJointStateToRobot } from './urdf/jointStateBinding'

/**
 * RobotVisualization (URDF + MCAP /joint_states)
 */

function fitCameraToBox(camera, controlsRef, box, padding = 1.6) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxDim) || maxDim <= 0) return

  const fov = (camera.fov * Math.PI) / 180
  const dist = (maxDim / 2 / Math.tan(fov / 2)) * padding

  const dir = new THREE.Vector3(1, 0.8, 1).normalize()
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)))

  // ✅ 반드시 추가
  camera.lookAt(center)

  // ✅ near를 충분히 작게, far는 충분히 크게
  camera.near = 0.01
  camera.far = 1000
  camera.updateProjectionMatrix()

  if (controlsRef?.current) {
    controlsRef.current.target.copy(center)
    controlsRef.current.update()
  }
}

// 로봇 메시 영구 캐시(세션 단위) — 로그 전환/재진입 시 재다운로드/재파싱 방지.
// - 클론들이 geometry를 공유하므로 캐시 항목은 dispose하지 않고 계속 보관한다.
// - 새 로봇(다른 메시 경로)을 열면 새 키로 추가될 뿐, 기존 항목은 유지(메모리 ↔ 속도 트레이드오프).
const GLOBAL_MESH_CACHE = new Map() // key(요청 경로) -> THREE.Object3D 프로토타입
// 메시 머티리얼 1개를 세션 내내 공유(캐시된 메시가 참조하므로 dispose하지 않는다).
const SHARED_ROBOT_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xcfd6e6, roughness: 0.5, metalness: 0.1 })

// 로봇 메시 CDN 인증 캐시(세션 영구, configId::version 단위) — download-auth는 Set-Cookie로 CDN 접근 권한을
// 내려주는 방식(3600초)이라, 첫 로드 성공 후에는 GLOBAL_MESH_CACHE가 영구 보관하므로 만료 이후에도 재요청이 필요 없다.
const MESH_CDN_CACHE = new Map() // key `${configId}::${version}` -> { baseUrl, expiresAt }
const meshCdnInflight = new Map() // key -> Promise<string|null>

// URDF의 <robot name="..."> 속성값 = CDN에서 이 로봇의 메시를 찾는 폴더명(configs/cloid/<모델명>/...).
// 서버가 cloid/ 아래를 모델명 단위로 나누기로 했으므로, package:// 이름이 아니라 이 값 기준으로 CDN을 조회한다.
function extractRobotModelName(robotDescription) {
  const m = /<robot\s+[^>]*\bname\s*=\s*"([^"]+)"/i.exec(String(robotDescription || ''))
  return m ? m[1] : null
}

// 로컬(public/urdf) STL은 삭제됐고 메시는 전부 CDN에서 온다 → 모델명(=<robot name>) 하나로
// 이 함수를 한 번만 호출해 CDN을 조회한다(URDF가 참조하는 package:// 개수와 무관).
// 이 함수의 성공 여부가 곧 메시 로딩 성공 여부다.
async function getMeshCdnBase(configId, modelName) {
  const key = `${configId}::${modelName}`
  const now = Date.now()
  const cached = MESH_CDN_CACHE.get(key)
  if (cached && cached.expiresAt - now > 10_000) return cached
  if (meshCdnInflight.has(key)) return meshCdnInflight.get(key)

  const p = fileApis
    .getMeshDownloadAuth(configId, modelName)
    .then((resp) => {
      const baseUrl = String(resp?.cdnBaseUrl || '').replace(/\/$/, '')
      if (!baseUrl) throw new Error('empty cdnBaseUrl')
      // download-auth가 실제로 존재/인가된 파일 목록을 내려주므로, 파일명(기준) -> url로 매핑해둔다.
      // URDF의 package:// 상대경로를 그대로 CDN 경로로 추측하지 않고, 이 목록에 있는 것만 요청하기 위함.
      const filesByName = new Map()
      for (const f of Array.isArray(resp?.files) ? resp.files : []) {
        const baseName = String(f?.name || '')
          .split('/')
          .pop()
        if (baseName && f?.url) filesByName.set(baseName.toLowerCase(), f.url)
      }
      const expiresAt = new Date(resp?.expiresAt).getTime()
      const entry = { baseUrl, filesByName, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + 55 * 60_000 }
      MESH_CDN_CACHE.set(key, entry)
      return entry
    })
    .catch((err) => {
      console.error(`[URDF] mesh CDN auth failed (${key}):`, err?.message || err)
      // 실패도 짧게 캐싱 — 로그 전환 때마다 아직 미지원인 configId를 반복 호출하지 않도록(60초 후 재시도).
      const entry = { baseUrl: null, filesByName: new Map(), expiresAt: now + 60_000 }
      MESH_CDN_CACHE.set(key, entry)
      return entry
    })
    .finally(() => {
      meshCdnInflight.delete(key)
    })

  meshCdnInflight.set(key, p)
  return p
}

// ───────────── STL 파싱 워커 풀(세션 영구) ─────────────
// 파싱을 메인 스레드 밖에서 병렬 처리 → UI 멈춤 제거 + 메시 동시 파싱으로 wall-clock 단축.
const STL_WORKER_POOL = []
const STL_WORKER_PENDING = new Map() // id -> { resolve, reject }
let _stlReqId = 0
let _stlPoolInit = false
let _stlRR = 0

function getStlWorkerPool() {
  if (_stlPoolInit) return STL_WORKER_POOL
  _stlPoolInit = true
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
  for (let i = 0; i < n; i++) {
    let w = null
    try {
      w = new Worker(new URL('./urdf/stlParseWorker.js', import.meta.url), { type: 'module' })
    } catch {
      w = null
    }
    if (!w) continue
    w.onmessage = (e) => {
      const { id, ok, position, normal, index, error } = e.data || {}
      const p = STL_WORKER_PENDING.get(id)
      if (!p) return
      STL_WORKER_PENDING.delete(id)
      if (ok) p.resolve({ position, normal, index })
      else p.reject(new Error(error || 'stl worker parse failed'))
    }
    w.onerror = () => {} // 개별 메시 실패는 호출부에서 폴백 처리
    STL_WORKER_POOL.push(w)
  }
  return STL_WORKER_POOL
}

// ArrayBuffer를 워커로 transfer해 파싱 → 속성 배열 반환
function parseStlInWorker(arrayBuffer) {
  const pool = getStlWorkerPool()
  if (!pool.length) return Promise.reject(new Error('no stl worker'))
  const id = ++_stlReqId
  const w = pool[_stlRR++ % pool.length]
  return new Promise((resolve, reject) => {
    STL_WORKER_PENDING.set(id, { resolve, reject })
    w.postMessage({ id, buffer: arrayBuffer }, [arrayBuffer])
  })
}

// 워커가 돌려준 속성 배열로 BufferGeometry 재구성
function buildGeometryFromArrays({ position, normal, index }) {
  const geo = new THREE.BufferGeometry()
  if (position) geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  if (normal) geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  if (index) geo.setIndex(new THREE.BufferAttribute(index, 1))
  if (!normal) {
    try {
      geo.computeVertexNormals()
    } catch {}
  }
  return geo
}

function URDFRobot({ robotRef, controlsRef, robotDescription }) {
  const { scene, camera } = useThree()

  useEffect(() => {
    const manager = new THREE.LoadingManager()
    if (typeof manager.resolveURL !== 'function') manager.resolveURL = (url) => url

    const loader = new URDFLoader(manager)

    // 로컬 public/urdf STL은 삭제됐고, 모든 메시는 CDN(dynamicPackageRoots, startLoad에서 사전 확보)에서만 온다.
    const dynamicPackageRoots = {} // targetPkg -> CDN baseUrl (startLoad에서 모든 패키지에 대해 채움)
    const dynamicPackageFiles = {} // targetPkg -> Map(파일명(소문자) -> download-auth가 내려준 실제 url)
    loader.packages = (targetPkg) => dynamicPackageRoots[targetPkg] || ''

    // URDFLoader는 packages(pkg) + URDF 상대경로를 그대로 이어붙여 최종 경로를 만드는데,
    // 이건 URDF의 상대경로가 CDN 실제 경로와 같다는 "추측"일 뿐이다. download-auth가 내려준
    // files 목록(=실제로 존재/인가된 파일)에 파일명이 있을 때만 그 url을 쓰고, 없으면 존재하지
    // 않는 CDN 경로로 요청을 보내지 않도록 null을 반환한다(호출부에서 에러 로그 후 중단).
    const resolveActualMeshPath = (rawPath) => {
      const raw = String(rawPath || '')
      const cdnPkg = Object.keys(dynamicPackageRoots).find(
        (pkg) => dynamicPackageRoots[pkg] && raw.startsWith(dynamicPackageRoots[pkg])
      )
      if (!cdnPkg) return raw // 이 패키지는 CDN 조회 자체가 안 된 경우(모델명 없음/조회 실패) — 그대로 반환해 자연스럽게 404 처리

      const baseName = raw.split('/').pop() || ''
      const matchedUrl = dynamicPackageFiles[cdnPkg]?.get(baseName.toLowerCase())
      return matchedUrl || null
    }

    // ✅ material 1개를 세션 내내 공유 (캐시된 메시가 참조 → effect마다 새로 만들지 않음)
    const sharedMat = SHARED_ROBOT_MATERIAL

    // mesh loaders
    const stl = new STLLoader(manager)
    const dae = new ColladaLoader(manager)
    const obj = new OBJLoader(manager)

    // ✅ mesh 캐시(세션 영구) + inflight(이번 로드 내 중복요청 합치기)
    // - meshCache: 모듈 레벨 영구 캐시 → 로그 전환/재진입 시 재다운로드 없이 즉시
    // - inflight: 같은 path가 동시에 여러 번 요청되면, 첫 1회 로딩에 콜백들을 묶어서 처리
    const meshCache = GLOBAL_MESH_CACHE // key(path) -> THREE.Object3D (prototype)
    const inflight = new Map() // key(path) -> Array<doneCb>

    const finishInflight = (key, objectOrNull) => {
      const cbs = inflight.get(key)
      inflight.delete(key)
      if (!cbs) return
      for (const cb of cbs) {
        try {
          if (objectOrNull) cb(objectOrNull.clone(true))
          else cb(null)
        } catch {
          try {
            cb(null)
          } catch {}
        }
      }
    }

    // URDFLoader.load()의 onComplete는 parse()가 끝나자마자(=각 <mesh> 태그마다 loadMeshCb를
    // "시작"만 시킨 시점) 바로 불린다 — 개별 메시(fetch+워커 파싱)가 실제로 끝나길 기다리지 않는다.
    // 그래서 onComplete에서 곧바로 Box3를 재면, 그 순간 캐시 히트 등으로 "우연히" 먼저 붙은
    // 일부(작은) 메시만 잡혀 bbox가 실제 로봇보다 훨씬 작게 나오고, 그걸 기준으로 2.5 목표 스케일을
    // 계산해버려 나머지 메시가 뒤늦게 붙을 때 로봇 전체가 과도하게 커 보이는 원인이 된다.
    // → loadMeshCb 호출 수를 카운트해 모든 메시가 실제로 붙은 뒤에만 스케일/카메라 피팅을 수행한다.
    let pendingMeshLoads = 0
    let parseDone = false
    let sizingDone = false

    const maybeApplySizing = () => {
      if (sizingDone || disposed || !parseDone || pendingMeshLoads > 0) return
      sizingDone = true

      const robot = robotRef.current
      if (!robot) return

      // ✅ 조건 없이 항상 스케일 정규화 (목표 높이 2.5 기준)
      const box1 = new THREE.Box3().setFromObject(robot)
      const size1 = box1.getSize(new THREE.Vector3())
      const maxDim1 = Math.max(size1.x, size1.y, size1.z)

      if (Number.isFinite(maxDim1) && maxDim1 > 0) {
        const s = 2.5 / maxDim1
        robot.scale.setScalar(s)
        robot.updateMatrixWorld(true)
      }

      // 스케일 적용 후 다시 box 계산
      const box2 = new THREE.Box3().setFromObject(robot)
      fitCameraToBox(camera, controlsRef, box2, 1.8)
    }

    loader.loadMeshCb = (rawPath, _manager, doneCb) => {
      pendingMeshLoads++
      const done = (obj) => {
        pendingMeshLoads--
        try {
          doneCb(obj)
        } finally {
          maybeApplySizing()
        }
      }

      const path = resolveActualMeshPath(rawPath)
      if (!path) {
        console.error('[URDF] mesh not found in CDN files list, skip:', rawPath)
        done(null)
        return
      }
      const key = String(path || '')
      const lower = key.toLowerCase()

      // ✅ 폴더명은 유지하고, 마지막 파일명만 소문자로 변환
      const fixedPath = key.replace(/[^/]+$/, (name) => name.toLowerCase())

      // ✅ cache / inflight key도 실제 요청 경로 기준으로 맞춤
      const requestKey = fixedPath

      // ✅ cache hit -> clone 반환
      const cached = meshCache.get(requestKey)
      if (cached) {
        done(cached.clone(true))
        return
      }

      // ✅ inflight hit -> 콜백만 등록하고 종료
      const inflightList = inflight.get(requestKey)
      if (inflightList) {
        inflightList.push(done)
        return
      }

      // ✅ 새 로드 시작
      inflight.set(requestKey, [done])

      if (lower.endsWith('.stl')) {
        const onGeo = (geo) => {
          // STL은 이미 normal 포함(바이너리=face normal) → 없을 때만 계산(시각 변화 없음)
          try {
            if (!geo.attributes?.normal) geo.computeVertexNormals()
          } catch {}
          const mesh = new THREE.Mesh(geo, sharedMat)
          meshCache.set(requestKey, mesh)
          finishInflight(requestKey, mesh)
        }

        // fetch → (워커 가능 시) 워커 병렬 파싱, 아니면 메인 스레드 폴백
        // credentials: 'include' — CDN이 쿠키(Set-Cookie, download-auth 발급)로 인증하므로 필요.
        const loadFrom = async (url) => {
          const resp = await fetchWithRetry(url, { credentials: 'include' })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const buf = await resp.arrayBuffer()
          if (getStlWorkerPool().length) {
            const arrays = await parseStlInWorker(buf) // buf는 워커로 transfer됨
            onGeo(buildGeometryFromArrays(arrays))
          } else {
            onGeo(stl.parse(buf)) // 워커 미지원 환경 폴백(메인 파싱)
          }
        }

        // ✅ 1차: 원본 경로(URDF 참조 그대로) → 2차: 소문자 폴백(대소문자 불일치 대비)
        loadFrom(key).catch(() => {
          if (fixedPath !== key) {
            loadFrom(fixedPath).catch((err) => {
              console.error('[URDF] STL load failed:', key, err?.message || err)
              finishInflight(requestKey, null)
            })
          } else {
            console.error('[URDF] STL load failed:', key)
            finishInflight(requestKey, null)
          }
        })

        return
      }

      if (lower.endsWith('.dae')) {
        dae.load(
          fixedPath,
          (collada) => {
            const root = collada?.scene
            if (!root) {
              finishInflight(requestKey, null)
              return
            }

            // ✅ material 통일(가능한 범위에서)
            try {
              root.traverse((n) => {
                if (n && n.isMesh) n.material = sharedMat
              })
            } catch {}

            meshCache.set(requestKey, root)
            finishInflight(requestKey, root)
          },
          undefined,
          (err) => {
            console.error('[URDF] DAE load failed:', fixedPath, err)
            finishInflight(requestKey, null)
          }
        )
        return
      }

      if (lower.endsWith('.obj')) {
        obj.load(
          fixedPath,
          (o) => {
            if (!o) {
              finishInflight(requestKey, null)
              return
            }
            try {
              o.traverse((n) => {
                if (n && n.isMesh) n.material = sharedMat
              })
            } catch {}

            meshCache.set(requestKey, o)
            finishInflight(requestKey, o)
          },
          undefined,
          (err) => {
            console.error('[URDF] OBJ load failed:', fixedPath, err)
            finishInflight(requestKey, null)
          }
        )
        return
      }

      console.warn('[URDF] Unsupported mesh type:', fixedPath)
      finishInflight(requestKey, null)
    }

    let disposed = false

    if (!robotDescription) return

    const startLoad = async () => {
      // 로컬 public/urdf STL은 삭제됐으므로 CDN(download-auth) 성공 여부가 곧 메시 로딩 성공 여부다
      // (피처 플래그/화이트리스트 없음 — 특정 모델명을 예외 취급하지 않음).
      // packages는 URDF 파싱 중 동기 호출되므로, 로드 전에 base URL을 미리 확보해둔다.
      // 서버는 configs/cloid/<모델명>/ 단위로 메시를 나눠두므로, 모델명 하나로 CDN을 한 번만 조회하고
      // URDF가 참조하는 모든 package://에 동일하게 적용한다.
      const referencedPkgs = Array.from(
        new Set([...robotDescription.matchAll(/package:\/\/([^/]+)\//g)].map((m) => m[1]))
      )
      const modelName = extractRobotModelName(robotDescription)

      if (modelName) {
        const meshCdn = await getMeshCdnBase('cloid', modelName)
        if (meshCdn?.baseUrl) {
          for (const pkg of referencedPkgs) {
            dynamicPackageRoots[pkg] = meshCdn.baseUrl
            dynamicPackageFiles[pkg] = meshCdn.filesByName
          }
        }
      }
      if (disposed) return

      const blob = new Blob([robotDescription], { type: 'text/xml' })
      const blobUrl = URL.createObjectURL(blob)

      loader.load(
        blobUrl,
        (robot) => {
          if (disposed) return

          scene.add(robot)
          robotRef.current = robot

          // ROS(Z-up) → three.js(Y-up)
          robot.rotation.x = -Math.PI / 2
          robot.updateMatrixWorld(true)

          // parse()는 각 메시 로딩을 "시작"만 시키고 끝나므로, 여기서는 아직 일부 메시가
          // 안 붙어있을 수 있다. 실제 스케일/카메라 피팅은 모든 메시가 붙은 뒤 maybeApplySizing에서.
          parseDone = true
          maybeApplySizing()
        },
        undefined,
        (err) => console.error('[URDF] load failed:', err)
      )
    }

    startLoad()

    return () => {
      disposed = true

      // 로딩 중에 inflight로 묶인 콜백은 모두 null 처리 (안전)
      try {
        for (const [key, list] of inflight.entries()) {
          for (const cb of list) {
            try {
              cb(null)
            } catch {}
          }
          inflight.delete(key)
        }
      } catch {}

      if (robotRef.current) {
        try {
          scene.remove(robotRef.current)
        } catch {}
        // ✅ 영구 캐시: robot 메시들은 캐시된 geometry를 공유하므로 dispose하지 않는다.
        //    (dispose하면 캐시가 깨져 다음 로드 시 다시 받아야 함). scene에서 제거만.
        robotRef.current = null
      }
      // meshCache(GLOBAL_MESH_CACHE)와 sharedMat(SHARED_ROBOT_MATERIAL)은 세션 영구라 유지.
    }
  }, [scene, camera, robotRef, controlsRef, robotDescription])

  return null
}

export default function RobotVisualization({ currentTime, mcapSummary }) {
  const robotRef = useRef(null)
  const controlsRef = useRef(null)

  // 정밀 윈도우(현재 시점 ±BACK/FWD초). 재생/느린 시크/드래그 정착 시 정확한 포즈용.
  const windowSamples = mcapSummary?.samples?.['/joint_states'] || null
  // 전체 타임라인 다운샘플(~400포인트). 빠른 드래그로 정밀 윈도우를 벗어난 순간에도
  // 로봇이 연속적으로 움직이도록 폴백 소스로 사용(거칠지만 끊기지 않음).
  const chartSamples = mcapSummary?.chartTimelineSamples || null
  const timeRange = mcapSummary?.timeRange || null

  const lastAppliedRef = useRef({ idx: -1 })

  useEffect(() => {
    const robot = robotRef.current
    if (!robot) return
    if (!Number.isFinite(currentTime)) return

    // 소스 선택: 정밀 윈도우가 currentTime을 커버하면 우선(정확). 벗어나면 전체 타임라인으로 폴백.
    // - 빠른 드래그: 윈도우 리로드(80ms 디바운스+비동기)가 못 따라오는 구간 → chartSamples로 스크럽 유지
    // - 드래그 정착/재생: 윈도우가 currentTime을 덮게 되면 정밀 포즈로 자동 복귀
    const coversTime = (samples, t) => {
      if (!Array.isArray(samples) || samples.length === 0) return false
      const first = samples[0]?.tSec
      const last = samples[samples.length - 1]?.tSec
      if (!Number.isFinite(first) || !Number.isFinite(last)) return false
      return t >= first - 0.05 && t <= last + 0.05
    }

    const jointSamples = coversTime(windowSamples, currentTime)
      ? windowSamples
      : Array.isArray(chartSamples) && chartSamples.length
        ? chartSamples
        : windowSamples

    if (!Array.isArray(jointSamples) || jointSamples.length === 0) return

    const picked = pickNearestJointStateSample(jointSamples, currentTime, timeRange)
    if (!picked) return

    // 같은 index는 스킵 (현재는 유지/미적용 상태)
    // if (picked.index === lastAppliedRef.current.idx) return
    // lastAppliedRef.current.idx = picked.index

    // 이름 변환 필요하면 여기에
    const nameTransform = null

    applyJointStateToRobot(robot, picked.sample?.msg ?? picked.sample, {
      nameTransform
    })
  }, [currentTime, windowSamples, chartSamples, timeRange])

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 360 }}>
      <Canvas
        camera={{ position: [3, 2.5, 3], fov: 50, near: 0.01, far: 1000 }}
        style={{ width: '100%', height: '100%', background: '#0B1929' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 4]} intensity={1.2} />
        <pointLight position={[-2, 3, -2]} intensity={0.25} />

        <URDFRobot
          robotRef={robotRef}
          controlsRef={controlsRef}
          robotDescription={mcapSummary?.mcapRobotDescription || null}
        />

        <Grid position={[0, 0, 0]} args={[4, 4]} cellSize={0.2} sectionSize={1} fadeDistance={5} />

        <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate />
      </Canvas>
    </div>
  )
}
