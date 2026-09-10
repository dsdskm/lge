import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Dropdown } from '@repo/ui'
import { FOOTPRINT_TOPICS, SPATIAL_TOPICS, subscribedTopicOf } from '@/constants/topics'
import { transformPoint } from '@/utils/tf'
import {
  Canvas,
  CanvasViewport,
  ObstacleDrawBar,
  ObstacleDrawBarRow,
  ObstacleDrawPanel,
  Placeholder,
  PlaceholderText
} from './styles'

// OccupancyGrid의 장애물 확률(0~100)에 따른 밝기(0~255) 값을 미리 계산한 캐시 배열
const BRIGHTNESS_CACHE = new Uint8Array(101)
for (let i = 0; i <= 100; i++) {
  BRIGHTNESS_CACHE[i] = Math.round(255 * (1 - i / 100))
}

// 뷰 조작 한계 — fit 배율 대비 상대값이라 지도 크기와 무관하게 동작한다
const ZOOM_MIN_RATIO = 0.5 // fit 대비 최소 배율(전체보기보다 조금 더 축소 가능)
const ZOOM_MAX_RATIO = 40 // fit 대비 최대 배율
const ZOOM_STEP = 1.1 // 휠 한 칸당 배율
const KEEP_VISIBLE = 0.3 // 팬 시 지도가 뷰포트와 최소로 겹쳐야 하는 비율
// 클릭으로 인정하는 이동 허용치(px) — 이보다 움직이면 팬(드래그)으로 본다.
const CLICK_SLOP = 4
// footprint 토픽(nav2 costmap)이 없을 때 로봇 마커에 쓰는 반경(m).
// 격자 칸 수가 아니라 미터로 잡아야 지도 해상도가 달라져도 실제 크기로 보인다.
// nav2 의 robot_radius 는 corepath 이미지 안 파라미터라 저장소에서 읽을 수 없어 대략치다 —
// 실제 치수가 확인되면 이 상수만 고치면 된다.
const FALLBACK_ROBOT_RADIUS_M = 0.3
// 마커 반경(px) — POI 는 이 크기로 고정하고, 로봇은 실제 크기가 이보다 작게 보일 때의 최소치로 쓴다.
// POI 는 크기가 있는 물체가 아니라 한 지점이고, 축소했을 때도 눌러 확인할 수 있어야 한다.
const MARKER_RADIUS_PX = 12
// 방향 표시 삼각형 — 마커 반경 대비 길이/밑변 절반. 밑변은 본체(원/폴리곤)에 묻히고 꼭지점만
// 밖으로 나와 부채꼴처럼 보인다(가는 선보다 방향이 한눈에 들어온다).
const MARKER_ARROW_LENGTH_RATIO = 1.9
const MARKER_ARROW_HALF_WIDTH_RATIO = 0.72
// 마커 중심의 흰 점 — 마커가 커지면 본체가 면으로 보여 정확한 좌표가 어디인지 흐려진다.
const MARKER_CORE_RATIO = 0.3
// POI 를 클릭으로 잡는 판정 반경(px) — 마커보다 조금 넉넉하게 잡아 정확히 점을 찍지 않아도 집힌다.
const POI_HIT_RADIUS_PX = MARKER_RADIUS_PX + 4

// 가상 장애물 사각형 — 면으로 영역을, 테두리로 경계를 보여준다. 지도(회색/검정)와 POI(앰버/초록)
// 사이에서 구분되도록 붉은 계열로 두고, 아래의 격자가 보여야 하므로 면은 반투명이다.
const OBSTACLE_FILL = 'rgba(231, 76, 60, 0.22)'
const OBSTACLE_STROKE = 'rgba(192, 57, 43, 0.95)'
// 목록에서 선택된 사각형 — 면을 진하게, 테두리를 굵게 하고 흰 외곽선(halo)을 깔아
// 여러 장애물이 겹쳐 있어도 어느 것이 선택됐는지 바로 보이게 한다.
const OBSTACLE_SELECTED_FILL = 'rgba(231, 76, 60, 0.38)'
const OBSTACLE_SELECTED_STROKE = 'rgba(155, 30, 20, 1)'
// 삭제 예정(작업본의 softDelete) — POI 마커와 같은 규약으로, 무엇이 지워질지가 먼저 보이도록
// 종류 색을 버리고 무채색으로 낮춘다.
const OBSTACLE_DELETED_FILL = 'rgba(127, 140, 141, 0.2)'
const OBSTACLE_DELETED_STROKE = 'rgba(127, 140, 141, 0.9)'
// 드래그 중인 사각형(아직 확정 전) — 확정된 장애물과 색으로 구분한다.
const OBSTACLE_DRAFT_FILL = 'rgba(41, 128, 185, 0.18)'
const OBSTACLE_DRAFT_STROKE = 'rgba(41, 128, 185, 0.95)'
// 사각형으로 인정하는 최소 드래그 크기(px). 이보다 작으면 그리기 모드에서 잘못 누른 것으로 보고
// 버린다 — 넓이 0 짜리 장애물이 목록에 쌓이는 것을 막는다.
const OBSTACLE_MIN_DRAG_PX = 6
// 편집 중인 사각형의 모서리 손잡이 — 반쪽 크기(px)와 잡는 판정 반경(px).
// 판정은 손잡이보다 넉넉하게 잡아 정확히 모서리를 찍지 않아도 집힌다(POI 마커와 같은 규약).
const OBSTACLE_HANDLE_HALF_PX = 5
const OBSTACLE_HANDLE_HIT_PX = OBSTACLE_HANDLE_HALF_PX + 5
// 회전 손잡이 — 위쪽 변 중앙에서 바깥으로 이 거리(px)만큼 띈 원. 모서리 손잡이와 헷갈리지
// 않도록 충분히 떨어뜨린다.
const OBSTACLE_ROTATE_HANDLE_OFFSET_PX = 26
const OBSTACLE_ROTATE_HANDLE_RADIUS_PX = 6
const OBSTACLE_ROTATE_HANDLE_HIT_PX = OBSTACLE_ROTATE_HANDLE_RADIUS_PX + 5

// 가상 장애물의 형태. 점은 클릭 한 번, 선분/사각형은 드래그 한 번, 폴리곤은 점을 하나씩 찍는다.
// 로봇(corepath_nav2_plugins::VirtualObstacleLayer)은 shape 를 모르고 점 개수로만 판정한다 —
// 1점은 반경 0.05 m 점, 2점은 거리 0.05 m 선분, 3점 이상은 폴리곤 내부다.
// shape 를 함께 들고 있는 이유는 편집 화면이 "사각형으로 그린 것"을 사각형 편집으로 다시 열어야
// 하기 때문이다(대각선 꼭지점 고정 리사이즈).
export const OBSTACLE_SHAPE_POINT = 'POINT'
export const OBSTACLE_SHAPE_LINE = 'LINE'
export const OBSTACLE_SHAPE_RECTANGLE = 'RECTANGLE'
export const OBSTACLE_SHAPE_POLYGON = 'POLYGON'
// 드래그 한 번으로 만드는 형태 — 누른 지점과 놓은 지점이 도형을 정한다.
const OBSTACLE_DRAG_SHAPES = [OBSTACLE_SHAPE_RECTANGLE, OBSTACLE_SHAPE_LINE]
// 면이 되는 최소 점 개수 — 이보다 적으면 닫을 수 없다.
const OBSTACLE_POLYGON_MIN_POINTS = 3
// 찍고 있는 폴리곤의 첫 점을 다시 눌러 닫는 판정 반경(px) — 손잡이보다 넉넉하게 잡는다.
const OBSTACLE_POLYGON_CLOSE_HIT_PX = 12
// 점(POINT) 장애물을 지도에 그릴 반경(px). 로봇 쪽 판정 반경(0.05 m)은 줌에 따라 1~2 px 밖에
// 안 되는 경우가 있어 화면에서는 보이는 크기로 그린다(POI 마커와 같은 규약).
const OBSTACLE_POINT_RADIUS_PX = 5

/**
 * 장애물 꼭지점의 z. 캔버스는 지도 평면만 다루므로 항상 0.0 이고, BE(map_obstacles.points)와
 * 로봇 yaml(polygon.points)이 {x, y, z} 3요소를 기대하므로 FE 가 실어 보낸다.
 */
const OBSTACLE_POINT_Z = 0.0

/**
 * 두 월드 좌표로 축정렬 사각형의 네 꼭지점을 만든다.
 *
 * 좌상 → 우상 → 우하 → 좌하 순서로 담는다(월드 기준 시계방향). 어느 방향으로 끌었는지와
 * 무관하게 같은 순서가 나오고, 인덱스 +2 가 대각선 반대 꼭지점이 된다(리사이즈에서 고정할 점).
 * 경계(min/max)를 저장하지 않는 이유는 로봇/BE 가 받는 형식이 "순서 있는 점 목록" 하나이기
 * 때문이다 — 표현을 하나로 두면 형태가 늘어도 저장/전송 경로가 갈라지지 않는다.
 */
const rectFromWorldPoints = (a, b) => {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return {
    shape: OBSTACLE_SHAPE_RECTANGLE,
    points: [
      { x: minX, y: maxY, z: OBSTACLE_POINT_Z },
      { x: maxX, y: maxY, z: OBSTACLE_POINT_Z },
      { x: maxX, y: minY, z: OBSTACLE_POINT_Z },
      { x: minX, y: minY, z: OBSTACLE_POINT_Z }
    ]
  }
}

/**
 * 회전된 사각형의 대각선 반대 꼭지점을 고정한 채 크기를 조절한다(캔버스 픽셀 기준).
 *
 * corners 는 rectFromWorldPoints 가 만드는 순서(0→1→2→3 이 시계로 돌며 각 변이
 * ex/ey/-ex/-ey 방향)를 그대로 따른다고 가정한다. 그 순서에서 축(ex, ey)을 다시 구해
 * "고정 꼭지점 기준으로 손끝까지의 폭/높이"만 새로 재고 나머지 꼭지점을 같은 축으로
 * 다시 배치하므로, 사각형이 회전해 있어도 그 회전이 그대로 유지된다(축정렬을 다시
 * 강제하는 rectFromWorldPoints 와 달리 방향을 보존한다).
 */
const resizeRotatedRectCorners = (corners, fixedIndex, target) => {
  const sub = (a, b) => ({ x: a.px - b.px, y: a.py - b.py })
  const dot = (a, b) => a.x * b.x + a.y * b.y
  const normalize = (v) => {
    const len = Math.hypot(v.x, v.y) || 1
    return { x: v.x / len, y: v.y / len }
  }
  const ex = normalize(sub(corners[1], corners[0]))
  const ey = normalize(sub(corners[3], corners[0]))
  const fixed = corners[fixedIndex]
  const delta = { x: target.x - fixed.px, y: target.y - fixed.py }
  const w = dot(delta, ex)
  const h = dot(delta, ey)
  // 꼭지점 i 의 로컬 좌표(0번 꼭지점 기준, ex/ey 단위) — rectFromWorldPoints 의 순서와 같다.
  const LOCAL = [
    { a: 0, b: 0 },
    { a: 1, b: 0 },
    { a: 1, b: 1 },
    { a: 0, b: 1 }
  ]
  const local = LOCAL[fixedIndex]
  const originPx = fixed.px - local.a * w * ex.x - local.b * h * ey.x
  const originPy = fixed.py - local.a * w * ex.y - local.b * h * ey.y
  return LOCAL.map(({ a, b }) => ({
    px: originPx + a * w * ex.x + b * h * ey.x,
    py: originPy + a * w * ex.y + b * h * ey.y
  }))
}

/** 찍은 점들을 확정된 도형으로 — 점 순서를 그대로 유지한다(폴리곤의 변 순서가 곧 모양이다). */
const shapeFromWorldPoints = (shape, points) => ({
  shape,
  points: points.map((point) => ({ x: point.x, y: point.y, z: OBSTACLE_POINT_Z }))
})

/**
 * 장애물 하나를 그릴 월드 좌표 꼭지점들.
 * 모든 형태가 순서 있는 points 하나로 표현되므로 그리기/손잡이 코드가 형태별로 갈리지 않는다.
 */
const obstacleWorldPoints = (obstacle) => {
  const points = Array.isArray(obstacle?.points) ? obstacle.points : []
  return points.filter((point) => typeof point?.x === 'number' && typeof point?.y === 'number')
}

/**
 * 방향(yaw)을 가리키는 삼각형. 마커 본체보다 먼저 그려서 밑변이 본체에 묻히게 한다.
 * 흰 테두리를 먼저 깔아 어두운 벽/점군 위에서도 윤곽이 살아 있게 한다.
 *
 * @param {number} yaw ROS 기준 방향(rad). 캔버스 y 축은 아래가 +라서 sin 부호를 뒤집어 쓴다.
 * @param {number} radius 마커 본체 반경(px) — 삼각형 크기는 여기에 비례한다.
 */
const drawHeadingWedge = (ctx, px, py, yaw, radius, fill) => {
  const dirX = Math.cos(yaw)
  const dirY = -Math.sin(yaw)
  const tipLen = radius * MARKER_ARROW_LENGTH_RATIO
  const halfWidth = radius * MARKER_ARROW_HALF_WIDTH_RATIO

  ctx.beginPath()
  ctx.moveTo(px + dirX * tipLen, py + dirY * tipLen)
  // 밑변 두 점 — 진행 방향에 수직으로 벌린다.
  ctx.lineTo(px - dirY * halfWidth, py + dirX * halfWidth)
  ctx.lineTo(px + dirY * halfWidth, py - dirX * halfWidth)
  ctx.closePath()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fillStyle = fill
  ctx.fill()
}

/** 마커 중심을 찍는 흰 점. 본체를 그린 뒤 위에 얹는다. */
const drawMarkerCore = (ctx, px, py, radius) => {
  ctx.beginPath()
  ctx.arc(px, py, radius * MARKER_CORE_RATIO, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
}

// POI 타입별 색상 — marker: 점/화살표, label: 이름 글자(흰 테두리 위에 얹히므로 더 진하게).
// 키는 목록의 poi.type 값이다(@repo/ui SemanticDetail 의 POI_TYPES = GENERAL/ETC, 그리고 BE 가
// 쓰는 CHARGING). 색 계열은 robot 앱 SiteMap 의 POI 표기(충전 초록 / 그 외 앰버)를 따른다.
const POI_TYPE_COLORS = {
  GENERAL: { marker: 'rgba(245, 158, 11, 0.9)', label: '#8a5200' }, // 앰버
  CHARGING: { marker: 'rgba(22, 163, 74, 0.9)', label: '#0f5132' }, // 초록
  ETC: { marker: 'rgba(142, 68, 173, 0.9)', label: '#5b2c6f' } // 보라
}
// 위 표에 없는 타입(BE 가 새 타입을 추가한 경우) 색을 만들 때 쓰는 해시 승수 —
// 타입 이름이 같으면 언제나 같은 색이 나오게 한다.
const POI_UNKNOWN_TYPE_HUE_SEED = 31
// 삭제 예정 POI 색 — 타입 구분보다 "지워질 POI" 라는 사실이 먼저 보여야 하므로 무채색으로 낮춘다.
const POI_DELETED_COLORS = { marker: 'rgba(127, 140, 141, 0.6)', label: '#7f8c8d' }

/** 문자열 → 0~359 색상각. 알려지지 않은 POI 타입에 안정적인 색을 배정한다. */
const hueOfText = (text) => {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * POI_UNKNOWN_TYPE_HUE_SEED + text.charCodeAt(i)) % 360
  }
  return hash
}

/** POI 타입에 대응하는 마커/라벨 색. 삭제 예정(작업본의 softDelete)은 타입과 무관하게 무채색이다. */
const poiColorsOf = (type, isDeleted) => {
  if (isDeleted) return POI_DELETED_COLORS
  if (POI_TYPE_COLORS[type]) return POI_TYPE_COLORS[type]
  const hue = hueOfText(String(type ?? ''))
  return { marker: `hsla(${hue}, 62%, 42%, 0.9)`, label: `hsl(${hue}, 70%, 26%)` }
}

/**
 * MapCanvas
 *
 * OccupancyGrid(지도) + PointCloud2/LaserScan(라이다) + 로봇 위치를
 * HTML Canvas 2D API로 렌더링하는 컴포넌트.
 * 토픽 이름은 로봇 구성에 따라 다르므로(@/constants/topics) 역할로 판단한다.
 *
 * 로봇 위치는 지도와 같은 프레임이어야 하므로 TF 합성 결과(robotPose, map->base_link)를
 * 쓴다. Odometry 토픽의 pose 는 lio_odom 프레임 기준이라 TF 부재 시 폴백으로만 쓴다.
 *
 * 렌더링 레이어 순서 (아래에서 위로):
 *   1. OccupancyGrid 격자 지도  (회색/흰색/검정)
 *   2. LaserScan 포인트          (빨간 점들)
 *   3. 커스텀 토픽(궤적/랜드마크/TF 등)
 *   4. 가상 장애물 도형            (사각형/폴리곤 — 반투명 붉은 면 + 테두리)
 *   5. POI 마커                   (타입별 색 점 + 방향 삼각형 + 이름)
 *   6. 로봇 위치 마커             (파란 외형 + 방향 삼각형)
 *      크기는 footprint 토픽(nav2 costmap)이 있으면 실제 폴리곤, 없으면 상수 반경으로 그린다.
 *      POI 와 겹쳐도 로봇이 보여야 하므로 가장 위에 그린다.
 *
 * @param {Array} [pois] 지도 위에 찍을 POI 목록. 각 항목은 시맨틱 화면의 POI 형태를 그대로 쓴다
 *   — { name: { default }, pose: { position: {x,y}, orientation: {x,y,z,w} }, editStatus }.
 *   좌표는 지도(map) 프레임 기준이라 보정 없이 찍는다.
 *
 * @param {Function} [onMapClick] 지도 클릭 시 호출 — ({x, y, canvasX, canvasY, poi}).
 *   x/y 는 지도 프레임 월드 좌표(m), canvasX/Y 는 래퍼 기준 픽셀(말풍선 배치용).
 *   드래그(팬)와 구분하기 위해 CLICK_SLOP 이내로 움직인 경우만 클릭으로 본다.
 *   클릭 지점이 POI 마커(POI_HIT_RADIUS_PX) 안이면 그 POI 를 poi 로 함께 넘기고, x/y/canvasX/Y 도
 *   마커 좌표로 맞춘다 — 말풍선이 마커에 붙고, 이동 목표가 클릭 오차 없이 POI 그 자리가 된다.
 *   POI 를 잡지 못하면 poi 는 null 이다.
 * @param {Function} [onViewChange] 줌/팬/전체보기로 뷰가 바뀔 때 호출 — canvasX/Y 기준 오버레이를
 *   띄운 쪽이 위치가 어긋난 오버레이를 닫을 수 있게 알려준다.
 *
 * @param {Array} [obstacles] 지도 위에 그릴 가상 장애물 목록(좌표는 지도 프레임, m) —
 *   { id, shape: 'POINT'|'LINE'|'RECTANGLE'|'POLYGON', points: [{x,y}...], editStatus }
 *   형태와 무관하게 좌표는 순서 있는 points 하나로만 표현한다(점 1 / 선분 2 / 사각형 4 /
 *   폴리곤 3 이상). 작업본의 삭제 예정(editStatus.softDelete)은 POI 마커와 같이 무채색으로
 *   낮춰 그린다.
 * @param {'POINT'|'LINE'|'RECTANGLE'|'POLYGON'|null} [drawObstacleShape] 가상 장애물 그리기
 *   모드와 형태. null 이면 꺼진 상태다. 켜져 있는 동안에는 지도 클릭(onMapClick)이 일어나지
 *   않고 더블클릭 전체보기도 막힌다 — 영역을 지정하는 중에 이동 말풍선이 뜨거나 뷰가 튀면 안 된다.
 *   POINT: 제자리 클릭 한 번으로 확정된다(끌면 평소처럼 팬이다).
 *   LINE / RECTANGLE: 좌클릭 드래그가 팬 대신 도형 그리기가 된다.
 *   POLYGON: 클릭마다 점이 하나 찍히고(끌면 평소처럼 팬이다), 첫 점을 다시 누르거나 우클릭 또는
 *   Enter 로 닫는다. Esc 는 찍던 점을 모두 버린다(모드는 유지 — 다시 찍기 시작할 수 있다).
 *   휠 확대/축소는 모든 형태에서 그대로 쓴다.
 * @param {Function} [onObstacleDrawn] 도형이 확정될 때 호출 — ({ shape, points: [{x,y}...] }).
 *   좌표는 지도 프레임(m)이고 점 순서는 그린 순서를 그대로 유지한다. 사각형만은 끈 방향과
 *   무관하게 좌상 → 우상 → 우하 → 좌하(월드 기준 시계방향)로 정규화되어 들어온다.
 * @param {string|number|null} [selectedObstacleId] 목록에서 선택된 장애물의 id — 그 도형만
 *   진하게 강조한다(목록과 지도에서 같은 것을 보고 있는지 확인하는 용도).
 * @param {string|number|null} [editingObstacleId] 고치는 중인 장애물의 id — 그 도형에만 꼭지점
 *   손잡이가 붙는다(다른 곳을 끌면 평소처럼 팬이다).
 * @param {Function} [onObstacleResize] 사각형(shape: 'RECTANGLE')의 모서리를 끄는 동안 계속
 *   호출 — (id, { shape: 'RECTANGLE', points: [4개] }). 끌던 모서리의 대각선 반대 꼭지점을
 *   고정하므로 어느 방향으로 끌어도 축정렬과 꼭지점 순서가 유지된다.
 * @param {Function} [onObstacleVertexMove] 그 밖의 형태(점/선분/폴리곤)에서 점을 끄는 동안 계속
 *   호출 — (id, index, { x, y }). 그 점만 옮긴다(다른 점은 그대로다).
 *
 * @param {Array} [obstacleShapeOptions] 그리기 중 지도 위 조작 줄에 띄울 형태 목록 —
 *   [{ value, name }]. 문구는 번역된 상태로 받는다(이 컴포넌트는 semantic 번역을 모른다).
 *   비어 있으면 조작 줄에 드롭다운을 그리지 않는다.
 * @param {Function} [onObstacleShapeChange] 조작 줄에서 형태를 바꿀 때 — (shape) => void.
 *   형태가 바뀌면 찍어 둔 좌표는 버려진다(형태마다 점 개수 규칙이 다르다).
 * @param {string} [obstacleShapeLabel] 형태 드롭다운 라벨.
 * @param {string} [obstacleDrawHint] 그리기 중 지도 위에 띄울 안내 문구(형태별).
 * @param {string} [obstaclePointsLabel] 찍은 좌표 목록의 제목.
 */
function MapCanvas({
  mapData,
  scanData,
  odomData,
  robotPose = null,
  subscribedTopics = [],
  customTopicsData = {},
  frameCorrections = {},
  // 지도 위에 찍을 POI 목록(시맨틱 화면의 목록 그대로). 빈 배열이면 아무것도 그리지 않는다.
  pois = [],
  // 라이다 점군 표시. POI 편집처럼 지도 자체가 관심사인 화면은 false 로 끈다
  // (구독은 유지되므로 다른 화면/패널의 표시는 영향받지 않는다).
  showScan = true,
  onMapClick = null,
  onViewChange = null,
  // 가상 장애물(시맨틱 화면) — 사각형 목록과 그리기 모드. 목록이 비어 있고 모드가 꺼져 있으면
  // 아무 동작도 달라지지 않으므로 다른 화면(스캔 등)은 이 props 를 넘기지 않아도 된다.
  obstacles = [],
  drawObstacleShape = null,
  onObstacleDrawn = null,
  selectedObstacleId = null,
  editingObstacleId = null,
  onObstacleResize = null,
  onObstacleVertexMove = null,
  // 그리기 중 지도 위에 겹쳐 띄우는 조작 줄(형태 선택 + 안내 + 찍은 좌표).
  obstacleShapeOptions = [],
  onObstacleShapeChange = null,
  obstacleShapeLabel = '',
  obstacleDrawHint = '',
  obstaclePointsLabel = ''
}) {
  const canvasRef = useRef(null)
  const wrapperRef = useRef(null)
  const mapCacheCanvasRef = useRef(null)
  const mapCacheValidRef = useRef(false)
  const lastMapDataRef = useRef(null)

  // 뷰 변환 — scale: 격자 1칸당 화면 픽셀 수, tx/ty: 지도 좌상단의 캔버스 좌표
  const viewRef = useRef({ scale: 0, tx: 0, ty: 0 })
  const fitScaleRef = useRef(0)
  // 현재 뷰가 어떤 격자 크기에 맞춰졌는지 — 지도가 바뀌면 다시 fit 한다
  const fitKeyRef = useRef('')
  // 사용자가 휠/드래그로 뷰를 건드렸는지 — 건드린 뒤에는 리사이즈 시 자동 fit 하지 않는다
  const userAdjustedRef = useRef(false)
  // 격자 크기 캐시 — 휠/드래그 핸들러가 render 없이도 클램프할 수 있게 한다
  const gridSizeRef = useRef({ w: 0, h: 0 })
  const dragRef = useRef(null)
  // 최신 render 를 이벤트 핸들러에서 호출하기 위한 ref
  const renderRef = useRef(() => {})

  // 클릭 좌표 역변환에 필요한 지도 기하 정보 — render 가 매번 갱신한다.
  const geoRef = useRef(null)
  // 지금 화면에 찍혀 있는 POI 마커의 캔버스 좌표 — 클릭으로 POI 를 집는 판정에 쓴다.
  // 줌/팬마다 값이 달라지므로 render 가 매번 다시 채운다(상태로 들 필요가 없다).
  const poiHitsRef = useRef([])
  // 드래그로 그리는 중인 가상 장애물(사각형/선분) — 캔버스 픽셀 기준 { shape, x0, y0, x1, y1 }.
  // 확정 전까지만 존재한다. 리렌더 없이 render 만 다시 돌려 미리보기를 그리므로 상태가 아니라 ref 다.
  const obstacleDraftRef = useRef(null)
  // 찍고 있는 폴리곤 — { points: [{x,y}(월드)...], cursor: {px,py}(캔버스) }. 점은 월드 좌표로
  // 들고 있어야 찍은 뒤 줌/팬을 해도 그 자리에 남는다. 확정 전까지만 존재한다.
  const polygonDraftRef = useRef(null)
  // 찍고 있는 폴리곤 점들의 현재 캔버스 좌표 — 첫 점을 다시 눌러 닫는 판정에 쓴다(render 가 채운다).
  const polygonDraftHitsRef = useRef([])
  // 편집 중인 도형의 꼭지점 손잡이 — { id, px, py, fixed: {x,y} } 또는 { id, px, py, index }.
  // fixed 는 사각형에서 크기를 조절할 때 고정되는 대각선 반대 꼭지점, index 는 폴리곤에서 옮길
  // 점의 자리다. POI 판정처럼 render 가 매번 다시 채운다.
  const obstacleHandlesRef = useRef([])
  // 지금 끌고 있는 손잡이. 있으면 마우스 이동이 팬이 아니라 크기 조절/점 옮기기다.
  const obstacleResizeRef = useRef(null)
  // 지금 끌고 있는 회전 손잡이 — { id, center, corners(드래그 시작 시점의 네 꼭지점) }.
  // 있으면 마우스 이동이 팬/크기 조절이 아니라 회전이다.
  const obstacleRotateRef = useRef(null)
  // 지도 위 조작 줄에 보여줄 "지금까지 찍은 좌표"(월드, m). 도형이 확정되기 전의 진행 상태다.
  // 그리기 자체는 ref + 캔버스 재그리기로 처리하지만(리렌더 없이), 이 값은 DOM 으로 보여줘야
  // 하므로 상태로 둔다 — 갱신 시점을 점이 실제로 늘거나 끝점이 바뀔 때로 제한해 둔다.
  const [obstacleDraftPoints, setObstacleDraftPoints] = useState([])
  // 콜백은 ref 로 들고 쓴다 — 리스너를 다시 붙이지 않아도 최신 함수가 호출된다.
  const onMapClickRef = useRef(onMapClick)
  const onViewChangeRef = useRef(onViewChange)
  const onObstacleDrawnRef = useRef(onObstacleDrawn)
  const onObstacleResizeRef = useRef(onObstacleResize)
  const onObstacleVertexMoveRef = useRef(onObstacleVertexMove)
  // 그리기 모드/형태도 같은 이유로 ref 로 본다 — 마우스 리스너는 한 번만 붙는다.
  const drawObstacleShapeRef = useRef(drawObstacleShape)
  useEffect(() => {
    onMapClickRef.current = onMapClick
    onViewChangeRef.current = onViewChange
    onObstacleDrawnRef.current = onObstacleDrawn
    onObstacleResizeRef.current = onObstacleResize
    onObstacleVertexMoveRef.current = onObstacleVertexMove
  }, [onMapClick, onViewChange, onObstacleDrawn, onObstacleResize, onObstacleVertexMove])

  /** 캔버스 픽셀 → ROS 월드 좌표(m). worldToCanvas 의 역변환. 지도 정보가 없으면 null. */
  const canvasToWorld = useCallback((canvasX, canvasY) => {
    const geo = geoRef.current
    const { scale, tx, ty } = viewRef.current
    if (!geo || !scale) return null
    const col = (canvasX - tx) / scale
    const row = geo.gridHeight - (canvasY - ty) / scale
    return { x: col * geo.resolution + geo.origin.x, y: row * geo.resolution + geo.origin.y }
  }, [])

  // 래퍼는 구독 상태에 따라 마운트/언마운트되므로, 리스너를 다시 붙이도록 state 로도 보관한다
  const [wrapperEl, setWrapperEl] = useState(null)
  const setWrapperNode = useCallback((node) => {
    wrapperRef.current = node
    setWrapperEl(node)
  }, [])

  /** 지도 전체가 보이도록 배율/위치를 계산해 뷰에 반영 */
  const applyFit = useCallback((canvasW, canvasH, gridW, gridH) => {
    if (!canvasW || !canvasH || !gridW || !gridH) return
    const scale = Math.min(canvasW / gridW, canvasH / gridH) * 0.95
    fitScaleRef.current = scale
    viewRef.current = {
      scale,
      tx: (canvasW - gridW * scale) / 2,
      ty: (canvasH - gridH * scale) / 2
    }
  }, [])

  /** 드래그로 지도를 화면 밖으로 완전히 밀어내지 못하도록 이동량 제한 */
  const clampView = useCallback(() => {
    const canvas = canvasRef.current
    const { w: gridW, h: gridH } = gridSizeRef.current
    if (!canvas || !gridW || !gridH) return
    const view = viewRef.current
    const mapW = gridW * view.scale
    const mapH = gridH * view.scale
    const keepX = Math.min(mapW, canvas.width) * KEEP_VISIBLE
    const keepY = Math.min(mapH, canvas.height) * KEEP_VISIBLE
    view.tx = Math.min(Math.max(view.tx, keepX - mapW), canvas.width - keepX)
    view.ty = Math.min(Math.max(view.ty, keepY - mapH), canvas.height - keepY)
  }, [])

  // mapData가 업데이트되면 백그라운드 캐시 캔버스에 지도를 미리 그림 (Double Buffering)
  useEffect(() => {
    if (!mapData) {
      mapCacheValidRef.current = false
      lastMapDataRef.current = null
      return
    }

    // mapData 레퍼런스가 동일한 경우 다시 그리지 않음
    if (lastMapDataRef.current === mapData) {
      return
    }

    lastMapDataRef.current = mapData

    const { width, height } = mapData.info
    const { data } = mapData

    if (!mapCacheCanvasRef.current) {
      mapCacheCanvasRef.current = document.createElement('canvas')
    }

    const cacheCanvas = mapCacheCanvasRef.current
    cacheCanvas.width = width
    cacheCanvas.height = height
    const cacheCtx = cacheCanvas.getContext('2d')

    // ImageData를 사용해 1차원 픽셀 버퍼에 고속 기록
    const imgData = cacheCtx.createImageData(width, height)
    const buf = imgData.data

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const rosRow = row
        // Canvas 좌표계는 y축이 반대이므로 반전 매핑
        const canvasRow = height - 1 - row

        const cellIndex = rosRow * width + col
        const cellValue = data[cellIndex]
        const bufIndex = (canvasRow * width + col) * 4

        if (cellValue === -1) {
          // 미탐색 영역: #cccccc
          buf[bufIndex] = 204
          buf[bufIndex + 1] = 204
          buf[bufIndex + 2] = 204
          buf[bufIndex + 3] = 255
        } else if (cellValue === 0) {
          // 빈 영역: #ffffff
          buf[bufIndex] = 255
          buf[bufIndex + 1] = 255
          buf[bufIndex + 2] = 255
          buf[bufIndex + 3] = 255
        } else {
          // 장애물: 명도 대비 그라데이션 (미리 계산된 캐시 배열 활용)
          const brightness = BRIGHTNESS_CACHE[cellValue] ?? 0
          buf[bufIndex] = brightness
          buf[bufIndex + 1] = brightness
          buf[bufIndex + 2] = brightness
          buf[bufIndex + 3] = 255
        }
      }
    }

    cacheCtx.putImageData(imgData, 0, 0)
    mapCacheValidRef.current = true
  }, [mapData])

  /**
   * 토픽 payload 의 프레임에 맞는 보정량을 찾는다.
   *
   * lio_node 는 매핑 중 궤적/경로를 lio_odom 기준으로 발행한다(측위 모드에서는 map 기준).
   * 루프 클로저로 map->lio_odom 보정이 0이 아니게 되면 그 좌표를 지도에 그대로 찍을 수 없다.
   * frame_id 가 없거나 이미 map 이면 null 을 돌려줘서 transformPoint 가 좌표를 그대로 쓴다.
   */
  const correctionFor = (topicData) => frameCorrections[topicData?.header?.frame_id] ?? null

  const getPointsList = (topicData) => {
    if (!topicData) return []
    if (Array.isArray(topicData.poses)) {
      return topicData.poses.map((p) => p.pose?.position ?? p.position ?? p)
    }
    if (Array.isArray(topicData.points) || topicData.points instanceof Float32Array) {
      return topicData.points
    }
    if (Array.isArray(topicData)) {
      return topicData.map((p) => p.position ?? p)
    }
    return []
  }

  /**
   * 전체 캔버스 렌더링 함수
   * 데이터가 변경될 때마다 호출됨
   */
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const hasMap = !!mapData
    const width = hasMap ? mapData.info.width : 500
    const height = hasMap ? mapData.info.height : 500
    const resolution = hasMap ? mapData.info.resolution : 0.05 // 기본 5cm

    // 캔버스는 컨테이너(뷰포트)를 가득 채우고, 지도는 뷰 변환(scale/tx/ty)으로 배치한다
    const wrapper = wrapperRef.current
    const targetWidth = Math.max(1, Math.floor(wrapper?.clientWidth || canvas.clientWidth || 600))
    const targetHeight = Math.max(1, Math.floor(wrapper?.clientHeight || canvas.clientHeight || 400))

    // 크기가 실제로 변경되었을 때만 가로/세로 속성을 할당하여 Canvas 초기화 오버헤드 방지
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    } else {
      // 크기가 변경되지 않았다면 이전 그림을 지워줌
      ctx.clearRect(0, 0, targetWidth, targetHeight)
    }

    // 지도(또는 기본 격자)가 바뀌면 화면 가운데에 전체가 보이도록 다시 맞춘다
    gridSizeRef.current = { w: width, h: height }
    const fitKey = `${width}x${height}`
    if (fitKeyRef.current !== fitKey || viewRef.current.scale <= 0) {
      fitKeyRef.current = fitKey
      userAdjustedRef.current = false
      applyFit(targetWidth, targetHeight, width, height)
    }

    const { scale: CELL_SIZE, tx, ty } = viewRef.current

    // ROS 월드 좌표(미터) → 캔버스 픽셀 좌표 변환
    // 지도 원점 또는 임의의 중앙 원점 (-12.5m, -12.5m) 사용해 (0,0)을 중앙에 오게 함
    const origin = hasMap ? (mapData.info.origin?.position ?? { x: 0, y: 0 }) : { x: -12.5, y: -12.5 }

    // 클릭 역변환(canvasToWorld)이 같은 기준을 쓰도록 현재 지도 기하를 남긴다.
    geoRef.current = { origin, resolution, gridHeight: height }

    const worldToCanvas = (wx, wy) => {
      const col = (wx - origin.x) / resolution
      const row = (wy - origin.y) / resolution
      const px = col * CELL_SIZE + tx
      const py = (height - row) * CELL_SIZE + ty
      return { px, py }
    }

    // ── Layer 1: OccupancyGrid 또는 격자 배경 렌더링 ─────────────────────
    if (hasMap) {
      if (mapCacheValidRef.current && mapCacheCanvasRef.current) {
        // Nearest-neighbor 필터링으로 픽셀을 또렷하게 렌더링
        ctx.imageSmoothingEnabled = false
        ctx.mozImageSmoothingEnabled = false
        ctx.webkitImageSmoothingEnabled = false
        ctx.msImageSmoothingEnabled = false

        ctx.drawImage(mapCacheCanvasRef.current, 0, 0, width, height, tx, ty, width * CELL_SIZE, height * CELL_SIZE)
      } else {
        // 캐시 준비중인 경우의 대체 렌더링
        ctx.fillStyle = '#cccccc'
        ctx.fillRect(tx, ty, width * CELL_SIZE, height * CELL_SIZE)
      }
    } else {
      // 맵이 없는 경우 격자 판 그리기
      ctx.fillStyle = '#f5f5f5'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.strokeStyle = '#e0e0e0'
      ctx.lineWidth = 1

      const step = 1.0 // 1미터 간격
      const minX = origin.x
      const maxX = origin.x + width * resolution
      const minY = origin.y
      const maxY = origin.y + height * resolution

      for (let wx = Math.ceil(minX); wx <= maxX; wx += step) {
        const { px } = worldToCanvas(wx, 0)
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, canvas.height)
        ctx.stroke()
      }
      for (let wy = Math.ceil(minY); wy <= maxY; wy += step) {
        const { py } = worldToCanvas(0, wy)
        ctx.beginPath()
        ctx.moveTo(0, py)
        ctx.lineTo(canvas.width, py)
        ctx.stroke()
      }
    }

    // ── Layer 2: LaserScan 또는 PointCloud2 렌더링 ────────────────────────────────────────
    if (showScan && subscribedTopicOf(subscribedTopics, 'scan') && scanData && odomData) {
      const pos = odomData.pose?.pose?.position ?? { x: 0, y: 0 }
      const quat = odomData.pose?.pose?.orientation ?? { x: 0, y: 0, z: 0, w: 1 }
      const yaw = Math.atan2(2 * (quat.w * quat.z + quat.x * quat.y), 1 - 2 * (quat.y * quat.y + quat.z * quat.z))

      ctx.fillStyle = 'rgba(231, 76, 60, 0.7)'
      ctx.beginPath()

      const r = Math.max(1.5, CELL_SIZE / 3)

      if (scanData.points instanceof Float32Array) {
        // PointCloud2 형식인 경우 (Float32Array 플랫 버퍼)
        const cosYaw = Math.cos(yaw)
        const sinYaw = Math.sin(yaw)
        const len = scanData.points.length
        for (let i = 0; i < len; i += 2) {
          const x = scanData.points[i]
          const y = scanData.points[i + 1]
          const wx = pos.x + (x * cosYaw - y * sinYaw)
          const wy = pos.y + (x * sinYaw + y * cosYaw)
          const { px, py } = worldToCanvas(wx, wy)

          ctx.moveTo(px + r, py)
          ctx.arc(px, py, r, 0, Math.PI * 2)
        }
      } else if (Array.isArray(scanData.points)) {
        // 기존 객체 배열 형식인 경우
        const cosYaw = Math.cos(yaw)
        const sinYaw = Math.sin(yaw)
        scanData.points.forEach((pt) => {
          if (typeof pt.x !== 'number' || typeof pt.y !== 'number') return
          const wx = pos.x + (pt.x * cosYaw - pt.y * sinYaw)
          const wy = pos.y + (pt.x * sinYaw + pt.y * cosYaw)
          const { px, py } = worldToCanvas(wx, wy)

          ctx.moveTo(px + r, py)
          ctx.arc(px, py, r, 0, Math.PI * 2)
        })
      } else if (scanData.ranges) {
        // LaserScan 형식인 경우
        const { angle_min, angle_increment, ranges, range_max } = scanData
        ranges.forEach((range, i) => {
          if (!isFinite(range) || range <= 0 || range >= range_max) return
          const angle = yaw + angle_min + i * angle_increment
          const wx = pos.x + range * Math.cos(angle)
          const wy = pos.y + range * Math.sin(angle)
          const { px, py } = worldToCanvas(wx, wy)

          ctx.moveTo(px + r, py)
          ctx.arc(px, py, r, 0, Math.PI * 2)
        })
      }
      ctx.fill()
    }

    // ── Layer 3: 커스텀 시각적 토픽 렌더링 ──────────────────────────────
    // 1) /scan_matched_points2 (매치된 라이다 점군)
    if (showScan && subscribedTopics.includes('/scan_matched_points2')) {
      const ptsData = customTopicsData['/scan_matched_points2']
      const pts = getPointsList(ptsData)
      ctx.fillStyle = 'rgba(52, 152, 219, 0.7)'
      ctx.beginPath()

      if (pts instanceof Float32Array) {
        const len = pts.length
        for (let i = 0; i < len; i += 2) {
          const { px, py } = worldToCanvas(pts[i], pts[i + 1])
          ctx.moveTo(px + 2, py)
          ctx.arc(px, py, 2, 0, Math.PI * 2)
        }
      } else if (Array.isArray(pts)) {
        pts.forEach((pt) => {
          if (typeof pt.x === 'number' && typeof pt.y === 'number') {
            const { px, py } = worldToCanvas(pt.x, pt.y)
            ctx.moveTo(px + 2, py)
            ctx.arc(px, py, 2, 0, Math.PI * 2)
          }
        })
      }
      ctx.fill()
    }

    /** 궤적 선 하나를 그린다 — 점들은 topicData 의 프레임 기준이라 map 으로 보정해서 찍는다. */
    const drawTrajectory = (topicData, strokeStyle) => {
      const pts = getPointsList(topicData)
      if (pts.length < 2) return
      const correction = correctionFor(topicData)

      ctx.beginPath()
      const first = transformPoint(correction, pts[0])
      const start = worldToCanvas(first.x, first.y)
      ctx.moveTo(start.px, start.py)
      for (let i = 1; i < pts.length; i++) {
        const world = transformPoint(correction, pts[i])
        const pt = worldToCanvas(world.x, world.y)
        ctx.lineTo(pt.px, pt.py)
      }
      ctx.strokeStyle = strokeStyle
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // 2) /trajectory_node_list (궤적 선 그리기)
    if (subscribedTopics.includes('/trajectory_node_list')) {
      drawTrajectory(customTopicsData['/trajectory_node_list'], '#e67e22')
    }

    // 2-1) /lio/path (LIO 주행 궤적 — nav_msgs/Path).
    // 매핑 중에는 lio_odom 기준으로 발행되므로 보정 없이 그리면 루프 클로저 이후 지도와 어긋난다.
    if (subscribedTopics.includes('/lio/path')) {
      drawTrajectory(customTopicsData['/lio/path'], '#8e44ad')
    }

    // 3) /landmark_poses_list (랜드마크 마커)
    if (subscribedTopics.includes('/landmark_poses_list')) {
      const landmarkData = customTopicsData['/landmark_poses_list']
      const pts = getPointsList(landmarkData)
      pts.forEach((pt) => {
        if (typeof pt.x === 'number' && typeof pt.y === 'number') {
          const { px, py } = worldToCanvas(pt.x, pt.y)
          ctx.beginPath()
          ctx.arc(px, py, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#2ecc71'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      })
    }

    // 4) /goal_pose (목표지점 깃발)
    if (subscribedTopics.includes('/goal_pose') && customTopicsData['/goal_pose']) {
      const gData = customTopicsData['/goal_pose']
      const pose = gData.pose?.position ?? gData.position ?? gData
      if (typeof pose.x === 'number' && typeof pose.y === 'number') {
        const { px, py } = worldToCanvas(pose.x, pose.y)
        ctx.beginPath()
        ctx.arc(px, py, 8, 0, Math.PI * 2)
        ctx.fillStyle = '#e74c3c'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.fillStyle = '#fff'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('G', px, py)
      }
    }

    // 5) /initialpose (시작지점 포즈)
    if (subscribedTopics.includes('/initialpose') && customTopicsData['/initialpose']) {
      const initData = customTopicsData['/initialpose']
      const pose = initData.pose?.pose?.position ?? initData.pose?.position ?? initData
      if (typeof pose.x === 'number' && typeof pose.y === 'number') {
        const { px, py } = worldToCanvas(pose.x, pose.y)
        ctx.beginPath()
        ctx.arc(px, py, 8, 0, Math.PI * 2)
        ctx.fillStyle = '#2ecc71'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.fillStyle = '#fff'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('S', px, py)
      }
    }

    // 6) /clicked_point (클릭된 위치 점)
    if (subscribedTopics.includes('/clicked_point') && customTopicsData['/clicked_point']) {
      const clickData = customTopicsData['/clicked_point']
      const pt = clickData.point ?? clickData
      if (typeof pt.x === 'number' && typeof pt.y === 'number') {
        const { px, py } = worldToCanvas(pt.x, pt.y)
        ctx.beginPath()
        ctx.arc(px, py, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#f1c40f'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    // 7) /tf 및 /tf_static (좌표축 프레임 렌더링)
    const drawTF = (tfData) => {
      if (!tfData || !Array.isArray(tfData.transforms)) return
      tfData.transforms.forEach((t) => {
        const translation = t.transform?.translation
        const rotation = t.transform?.rotation
        if (!translation) return

        const { px, py } = worldToCanvas(translation.x, translation.y)

        let yaw = 0
        if (rotation) {
          yaw = Math.atan2(
            2 * (rotation.w * rotation.z + rotation.x * rotation.y),
            1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z)
          )
        }

        // X축 (빨강)
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px + 15 * Math.cos(yaw), py - 15 * Math.sin(yaw))
        ctx.strokeStyle = '#e74c3c'
        ctx.lineWidth = 2
        ctx.stroke()

        // Y축 (초록)
        const yawY = yaw + Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px + 15 * Math.cos(yawY), py - 15 * Math.sin(yawY))
        ctx.strokeStyle = '#2ecc71'
        ctx.lineWidth = 2
        ctx.stroke()

        // 라벨 이름
        ctx.fillStyle = '#34495e'
        ctx.font = '9px monospace'
        ctx.fillText(t.child_frame_id || '', px + 8, py - 8)
      })
    }

    if (subscribedTopics.includes('/tf')) {
      drawTF(customTopicsData['/tf'])
    }
    if (subscribedTopics.includes('/tf_static')) {
      drawTF(customTopicsData['/tf_static'])
    }

    // ── Layer 4: 가상 장애물(점/선분/사각형/폴리곤) ─────────────────────────
    // POI 와 마찬가지로 저장된 맵 기준 좌표라 프레임 보정 없이 찍는다.
    // POI/로봇보다 아래에 둔다 — 영역이 마커를 덮으면 어느 지점인지 안 보인다.
    // 네 형태 모두 순서 있는 점 목록 하나로 그린다(그리기/손잡이 코드가 하나가 된다):
    //   1점  — 점 마커(면이 없다)
    //   2점  — 열린 선분(닫으면 같은 선을 두 번 긋는다)
    //   3점+ — 닫힌 면
    const paintObstacleShape = (canvasPoints, { fill, stroke, lineWidth = 2, dashed = false, halo = false }) => {
      if (canvasPoints.length === 0) return

      // 점 하나 — 원으로 찍는다. 흰 테두리는 halo 와 무관하게 늘 둘러 어두운 벽 위에서도 보인다.
      if (canvasPoints.length === 1) {
        const [point] = canvasPoints
        ctx.beginPath()
        ctx.arc(point.px, point.py, OBSTACLE_POINT_RADIUS_PX, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.lineWidth = lineWidth + 1
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(point.px, point.py, OBSTACLE_POINT_RADIUS_PX, 0, Math.PI * 2)
        ctx.strokeStyle = stroke
        ctx.lineWidth = lineWidth
        if (dashed) ctx.setLineDash([4, 3])
        ctx.stroke()
        if (dashed) ctx.setLineDash([])
        return
      }

      const closed = canvasPoints.length >= 3
      const trace = () => {
        ctx.beginPath()
        canvasPoints.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.px, point.py)
          else ctx.lineTo(point.px, point.py)
        })
        if (closed) ctx.closePath()
      }

      trace()
      // 선분은 면이 없다 — 채우면 아무것도 안 보이거나 선이 두꺼워 보이기만 한다.
      if (closed) {
        ctx.fillStyle = fill
        ctx.fill()
      }
      // 흰 외곽선을 먼저 굵게 깔면 어두운 벽/다른 장애물 위에서도 테두리가 살아 있다
      // (POI 마커의 흰 테두리와 같은 규약).
      if (halo) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.lineWidth = lineWidth + 3
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
      ctx.strokeStyle = stroke
      ctx.lineWidth = lineWidth
      ctx.lineJoin = 'round'
      if (dashed) ctx.setLineDash([6, 4])
      ctx.stroke()
      if (dashed) ctx.setLineDash([])
    }

    /** 편집 중인 도형의 꼭지점 손잡이 — 흰 속을 둔 정사각형으로 그려 눌러 잡을 곳임을 보여준다. */
    const drawObstacleHandle = (px, py) => {
      const size = OBSTACLE_HANDLE_HALF_PX * 2
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.fillRect(px - OBSTACLE_HANDLE_HALF_PX, py - OBSTACLE_HANDLE_HALF_PX, size, size)
      ctx.strokeStyle = OBSTACLE_SELECTED_STROKE
      ctx.lineWidth = 2
      ctx.strokeRect(px - OBSTACLE_HANDLE_HALF_PX, py - OBSTACLE_HANDLE_HALF_PX, size, size)
    }

    /** 회전 손잡이 — 위쪽 변 중앙(anchor)에서 손잡이(px,py)까지 안내선을 긋고 원을 그린다. */
    const drawObstacleRotateHandle = (anchorPx, anchorPy, px, py) => {
      ctx.beginPath()
      ctx.moveTo(anchorPx, anchorPy)
      ctx.lineTo(px, py)
      ctx.strokeStyle = OBSTACLE_SELECTED_STROKE
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(px, py, OBSTACLE_ROTATE_HANDLE_RADIUS_PX, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.fill()
      ctx.strokeStyle = OBSTACLE_SELECTED_STROKE
      ctx.lineWidth = 2
      ctx.stroke()
    }

    obstacleHandlesRef.current = []
    obstacles.forEach((obstacle) => {
      const worldPoints = obstacleWorldPoints(obstacle)
      if (worldPoints.length === 0) return
      const id = obstacle?.id
      const canvasPoints = worldPoints.map((point) => worldToCanvas(point.x, point.y))
      // 편집 중인 도형은 선택된 것으로도 본다 — 목록에서 수정을 누르면 함께 선택되지만,
      // 어느 쪽이 끊겨도 편집 대상은 강조되어야 한다.
      // 삭제 예정(작업본의 softDelete)은 목록에도 남아 있으므로 지우지 않고 무채색으로 낮춘다.
      const isDeleted = !!obstacle?.editStatus?.softDelete
      const isEditing = !isDeleted && id != null && id === editingObstacleId
      const isSelected = isEditing || (id != null && id === selectedObstacleId)
      paintObstacleShape(canvasPoints, {
        fill: isDeleted ? OBSTACLE_DELETED_FILL : isSelected ? OBSTACLE_SELECTED_FILL : OBSTACLE_FILL,
        stroke: isDeleted ? OBSTACLE_DELETED_STROKE : isSelected ? OBSTACLE_SELECTED_STROKE : OBSTACLE_STROKE,
        lineWidth: isSelected ? 3 : 2,
        halo: isSelected
      })

      if (!isEditing) return
      // 꼭지점마다 손잡이를 붙인다. 끌었을 때 무엇이 되는지는 도형에 따라 다르므로 함께 남긴다:
      //   사각형 — 대각선 반대 꼭지점(fixedIndex)을 고정한 크기 조절. corners 를 함께 남겨
      //     드래그 시작 시점의 네 꼭지점(캔버스 픽셀)으로 지금의 회전을 그대로 유지한 채
      //     늘이거나 줄인다(resizeRotatedRectCorners).
      //   그 밖(점/선분/폴리곤) — 그 점(index)만 옮기기
      const isRectangle = obstacle?.shape === OBSTACLE_SHAPE_RECTANGLE && worldPoints.length === 4
      canvasPoints.forEach((point, index) => {
        drawObstacleHandle(point.px, point.py)
        obstacleHandlesRef.current.push({
          id,
          px: point.px,
          py: point.py,
          ...(isRectangle ? { fixedIndex: (index + 2) % 4, corners: canvasPoints } : { index })
        })
      })

      // 회전 손잡이 — 위쪽 변(0→1) 중앙에서 사각형 중심의 반대쪽(바깥)으로 띄운다.
      // 중심을 지나는 방향이라 사각형이 어느 쪽으로 돌아 있어도 항상 "바깥"이 된다.
      if (isRectangle) {
        const [c0, c1, c2, c3] = canvasPoints
        const midX = (c0.px + c1.px) / 2
        const midY = (c0.py + c1.py) / 2
        const centerX = (c0.px + c1.px + c2.px + c3.px) / 4
        const centerY = (c0.py + c1.py + c2.py + c3.py) / 4
        let outX = midX - centerX
        let outY = midY - centerY
        const outLen = Math.hypot(outX, outY) || 1
        outX /= outLen
        outY /= outLen
        const handlePx = midX + outX * OBSTACLE_ROTATE_HANDLE_OFFSET_PX
        const handlePy = midY + outY * OBSTACLE_ROTATE_HANDLE_OFFSET_PX
        drawObstacleRotateHandle(midX, midY, handlePx, handlePy)
        obstacleHandlesRef.current.push({
          id,
          px: handlePx,
          py: handlePy,
          rotate: true,
          center: { px: centerX, py: centerY },
          corners: canvasPoints
        })
      }
    })

    // 드래그 중인 사각형/선분 — 이미 캔버스 픽셀이라 뷰 변환을 거치지 않는다.
    // 점선으로 그려 확정된 장애물과 구분한다.
    const draft = obstacleDraftRef.current
    if (draft) {
      const draftPoints =
        draft.shape === OBSTACLE_SHAPE_LINE
          ? // 선분은 끈 방향 그대로 두 점이다(정규화하면 시작/끝이 뒤바뀐다).
            [
              { px: draft.x0, py: draft.y0 },
              { px: draft.x1, py: draft.y1 }
            ]
          : [
              { px: Math.min(draft.x0, draft.x1), py: Math.min(draft.y0, draft.y1) },
              { px: Math.max(draft.x0, draft.x1), py: Math.min(draft.y0, draft.y1) },
              { px: Math.max(draft.x0, draft.x1), py: Math.max(draft.y0, draft.y1) },
              { px: Math.min(draft.x0, draft.x1), py: Math.max(draft.y0, draft.y1) }
            ]
      paintObstacleShape(draftPoints, {
        fill: OBSTACLE_DRAFT_FILL,
        stroke: OBSTACLE_DRAFT_STROKE,
        dashed: true
      })
    }

    // 찍고 있는 폴리곤 — 점은 월드 좌표로 들고 있어(줌/팬을 해도 찍은 자리에 남는다) 매번 옮겨 찍는다.
    // 마지막 점에서 커서까지 고무줄을 이어 다음 변이 어디로 갈지 보여주고, 3점부터는 첫 점을
    // 크게 그려 "여기를 누르면 닫힌다"를 알린다.
    const polygonDraft = polygonDraftRef.current
    polygonDraftHitsRef.current = []
    if (polygonDraft?.points?.length) {
      const points = polygonDraft.points.map((point) => worldToCanvas(point.x, point.y))
      polygonDraftHitsRef.current = points
      const cursor = polygonDraft.cursor
      const outline = cursor ? [...points, cursor] : points

      if (outline.length >= 3) {
        paintObstacleShape(outline, {
          fill: OBSTACLE_DRAFT_FILL,
          stroke: OBSTACLE_DRAFT_STROKE,
          dashed: true
        })
      } else {
        // 아직 면이 안 되는 1~2점 — 선만 점선으로 잇는다.
        ctx.beginPath()
        outline.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.px, point.py)
          else ctx.lineTo(point.px, point.py)
        })
        ctx.strokeStyle = OBSTACLE_DRAFT_STROKE
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.stroke()
        ctx.setLineDash([])
      }

      points.forEach((point, index) => {
        const closable = index === 0 && points.length >= OBSTACLE_POLYGON_MIN_POINTS
        ctx.beginPath()
        ctx.arc(point.px, point.py, closable ? OBSTACLE_HANDLE_HALF_PX + 2 : OBSTACLE_HANDLE_HALF_PX, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.fill()
        ctx.strokeStyle = OBSTACLE_DRAFT_STROKE
        ctx.lineWidth = 2
        ctx.stroke()
      })
    }

    // ── Layer 5: POI 마커 ────────────────────────────────────────────────
    // 지도(map) 프레임 좌표를 그대로 찍는다 — POI 는 저장된 맵 기준 좌표라 보정 대상이 아니다.
    // 마지막 레이어로 두어 지도/점군 위에 얹는다.
    poiHitsRef.current = []
    if (pois.length > 0) {
      ctx.font = '600 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'

      pois.forEach((poi) => {
        const position = poi?.pose?.position
        if (typeof position?.x !== 'number' || typeof position?.y !== 'number') return

        const { px, py } = worldToCanvas(position.x, position.y)
        // 클릭 판정용 좌표를 그린 그대로 남긴다 — 그리기와 판정이 같은 뷰 변환을 쓰게 된다.
        poiHitsRef.current.push({ poi, px, py })
        // 색은 타입(poi.type)으로 구분한다. 삭제 예정(작업본의 softDelete)은 목록에도 남아 있으므로
        // 지우지 않고 무채색으로 낮춰 구분만 한다.
        const isDeleted = !!poi?.editStatus?.softDelete
        const { marker: fill, label: labelColor } = poiColorsOf(poi?.type, isDeleted)

        // 방향(orientation) 이 있으면 삼각형으로 함께 보여준다 — POI 는 도착 지점의 방향도 뜻한다.
        const quat = poi?.pose?.orientation
        if (quat && (quat.z !== 0 || quat.w !== 1)) {
          const yaw = Math.atan2(2 * (quat.w * quat.z + quat.x * quat.y), 1 - 2 * (quat.y * quat.y + quat.z * quat.z))
          drawHeadingWedge(ctx, px, py, yaw, MARKER_RADIUS_PX, fill)
        }

        ctx.beginPath()
        ctx.arc(px, py, MARKER_RADIUS_PX, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
        drawMarkerCore(ctx, px, py, MARKER_RADIUS_PX)

        // 이름 — 지도(흰 바탕/검은 벽) 어디에서나 읽히도록 흰 테두리를 두른 글자로 찍는다.
        const label = poi?.name?.default ?? poi?.name?.['ko-KR'] ?? poi?.name?.['en-US'] ?? ''
        if (label) {
          const ty = py - MARKER_RADIUS_PX - 5
          ctx.lineWidth = 3
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
          ctx.strokeText(label, px, ty)
          ctx.fillStyle = labelColor
          ctx.fillText(label, px, ty)
        }
      })
    }

    // ── Layer 6: 로봇 위치 마커 렌더링 ──────────────────────────────────
    // 가장 마지막(최상위) 레이어다 — POI 와 겹쳐도 로봇이 어디에 있는지가 먼저 보여야 한다.
    // 지도와 같은 프레임(map)인 robotPose 를 우선 사용한다. TF 가 아직 안 모였을 때만
    // /lio/odom 으로 폴백한다 — 이 값은 lio_odom 프레임이라 보정량이 반영되지 않는다.
    const markerPose =
      robotPose ??
      (subscribedTopicOf(subscribedTopics, 'odom') && odomData
        ? (() => {
            const pos = odomData.pose?.pose?.position ?? { x: 0, y: 0 }
            const quat = odomData.pose?.pose?.orientation ?? { x: 0, y: 0, z: 0, w: 1 }
            return {
              x: pos.x,
              y: pos.y,
              yaw: Math.atan2(2 * (quat.w * quat.z + quat.x * quat.y), 1 - 2 * (quat.y * quat.y + quat.z * quat.z))
            }
          })()
        : null)

    if (markerPose) {
      const { yaw } = markerPose
      const { px, py } = worldToCanvas(markerPose.x, markerPose.y)

      // 크기는 로봇 외형(footprint) 폴리곤이 있으면 그걸 그대로 쓰고, 없으면 상수 반경으로
      // 폴백한다 — footprint 는 nav2(corepath) 가 떠 있을 때만 발행되므로 매핑 단계에서는 없다.
      const footprintTopic = FOOTPRINT_TOPICS.find((topic) => subscribedTopics.includes(topic))
      const footprintData = footprintTopic ? customTopicsData[footprintTopic] : null
      const footprintPts = footprintData?.polygon?.points ?? []
      // 폴리곤 점들은 costmap global_frame 기준이라 map 으로 보정해서 찍는다
      // (global_costmap 은 이미 map 이라 보정량이 null 이 되고 좌표가 그대로 쓰인다).
      const footprintCorrection = correctionFor(footprintData)

      // 본체 크기를 픽셀로 먼저 잡는다 — 방향 삼각형이 본체 밖으로 나와야 하므로 폴리곤이 있으면
      // 그 최대 반경을 쓴다(그러지 않으면 큰 로봇에서 삼각형이 본체에 완전히 묻힌다).
      const footprintCanvasPts =
        footprintPts.length >= 3
          ? footprintPts.map((pt) => {
              const world = transformPoint(footprintCorrection, pt)
              return worldToCanvas(world.x, world.y)
            })
          : []
      const footprintRadiusPx = footprintCanvasPts.reduce(
        (max, corner) => Math.max(max, Math.hypot(corner.px - px, corner.py - py)),
        0
      )
      // 실제 크기에 비례하되, 축소했을 때 POI 보다 작아지지 않도록 MARKER_RADIUS_PX 를 하한으로 둔다.
      const radiusPx = Math.max(
        MARKER_RADIUS_PX,
        footprintRadiusPx || (FALLBACK_ROBOT_RADIUS_M / resolution) * CELL_SIZE
      )
      const robotFill = 'rgba(41, 128, 185, 0.9)'

      // 방향 삼각형을 본체보다 먼저 그려 밑변을 본체 안에 묻는다(POI 마커와 같은 규약).
      drawHeadingWedge(ctx, px, py, yaw, radiusPx, robotFill)

      ctx.beginPath()
      if (footprintCanvasPts.length >= 3) {
        footprintCanvasPts.forEach((corner, i) => {
          if (i === 0) ctx.moveTo(corner.px, corner.py)
          else ctx.lineTo(corner.px, corner.py)
        })
        ctx.closePath()
      } else {
        ctx.arc(px, py, radiusPx, 0, Math.PI * 2)
      }
      ctx.fillStyle = robotFill
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
      drawMarkerCore(ctx, px, py, radiusPx)
    }
  }, [
    mapData,
    scanData,
    odomData,
    robotPose,
    subscribedTopics,
    customTopicsData,
    frameCorrections,
    pois,
    obstacles,
    selectedObstacleId,
    editingObstacleId,
    showScan,
    applyFit
  ])

  // 데이터 변경 시 리렌더링
  useEffect(() => {
    render()
  }, [render])

  // 이벤트 핸들러가 항상 최신 render 를 쓰도록 ref 로 유지
  useEffect(() => {
    renderRef.current = render
  }, [render])

  // 컨테이너 크기 변경 시 — 사용자가 뷰를 건드리지 않았으면 다시 가운데 맞춤
  useEffect(() => {
    const wrapper = wrapperEl
    if (!wrapper || typeof ResizeObserver === 'undefined') {
      const handleResize = () => renderRef.current()
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }

    const observer = new ResizeObserver(() => {
      if (!userAdjustedRef.current) {
        // fitKey 를 비워 render 가 새 캔버스 크기로 다시 fit 하게 한다
        fitKeyRef.current = ''
      } else {
        clampView()
      }
      renderRef.current()
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [wrapperEl, clampView])

  // 휠 확대/축소(커서 기준) + 드래그 이동
  useEffect(() => {
    const wrapper = wrapperEl
    if (!wrapper) return

    const zoomAt = (mx, my, factor) => {
      const view = viewRef.current
      const fitScale = fitScaleRef.current || view.scale
      if (!view.scale || !fitScale) return
      const next = Math.min(Math.max(view.scale * factor, fitScale * ZOOM_MIN_RATIO), fitScale * ZOOM_MAX_RATIO)
      if (next === view.scale) return
      // 커서 아래의 지도 지점이 그대로 유지되도록 이동량 보정
      const ratio = next / view.scale
      viewRef.current = {
        scale: next,
        tx: mx - (mx - view.tx) * ratio,
        ty: my - (my - view.ty) * ratio
      }
      userAdjustedRef.current = true
      clampView()
      renderRef.current()
      onViewChangeRef.current?.()
    }

    // 브라우저가 React 의 onWheel 을 passive 로 등록해 preventDefault 가 먹지 않으므로
    // 네이티브 리스너를 passive: false 로 직접 붙인다(페이지 스크롤 방지).
    const handleWheel = (e) => {
      // 조작 줄 위에서 굴린 휠은 지도 확대/축소가 아니다(드롭다운 목록 스크롤을 막지 않는다).
      if (isOverlayEvent(e)) return
      e.preventDefault()
      const rect = (canvasRef.current ?? wrapper).getBoundingClientRect()
      if (!rect.width || !rect.height) return
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)
    }

    /** 마우스 이벤트의 캔버스(래퍼) 기준 픽셀 좌표. */
    const canvasPointOf = (e) => {
      const rect = (canvasRef.current ?? wrapper).getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    /**
     * 지도 위 조작 줄(그리기 중 오버레이) 안에서 난 이벤트인지.
     *
     * 오버레이는 뷰포트의 자식이라 그 안을 눌러도 이벤트가 여기까지 올라온다 — 그대로 두면
     * 형태 드롭다운을 누르는 순간 그 자리에서 사각형 그리기가 시작된다.
     * React 의 stopPropagation 으로는 막을 수 없다: 이 리스너들은 wrapper 에 직접 붙어 있어
     * 루트에 위임된 React 핸들러보다 먼저 실행된다. 그래서 여기서 대상만 걸러낸다.
     */
    const isOverlayEvent = (e) => !!e.target?.closest?.('[data-obstacle-overlay]')

    /** 캔버스 좌표에서 잡을 수 있는 꼭지점 손잡이 — 판정 반경 안에서 가장 가까운 하나. */
    const obstacleHandleAt = (point) =>
      obstacleHandlesRef.current.reduce((best, candidate) => {
        const distance = Math.hypot(candidate.px - point.x, candidate.py - point.y)
        const hitPx = candidate.rotate ? OBSTACLE_ROTATE_HANDLE_HIT_PX : OBSTACLE_HANDLE_HIT_PX
        if (distance > hitPx) return best
        return !best || distance < best.distance ? { ...candidate, distance } : best
      }, null)

    /** 찍고 있는 폴리곤을 확정해 올려보낸다. 점이 모자라면 아무 일도 하지 않는다. */
    const commitPolygonDraft = () => {
      const points = polygonDraftRef.current?.points ?? []
      if (points.length < OBSTACLE_POLYGON_MIN_POINTS) return
      polygonDraftRef.current = null
      setObstacleDraftPoints([])
      renderRef.current()
      onObstacleDrawnRef.current?.(shapeFromWorldPoints(OBSTACLE_SHAPE_POLYGON, points))
    }

    /**
     * 조작 줄에 보여줄 좌표 갱신 — 소수 둘째 자리(표시 자리수)에서 값이 실제로 바뀔 때만
     * 상태를 건드린다. 드래그 중에는 mousemove 가 초당 수십 번 오므로 매번 setState 하면
     * 같은 문자열을 다시 그리기만 한다.
     */
    const setDraftPointsIfChanged = (points) => {
      const key = (list) => list.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('|')
      setObstacleDraftPoints((prev) => (key(prev) === key(points) ? prev : points))
    }

    const handleMouseDown = (e) => {
      if (e.button !== 0) return
      // 조작 줄(형태 드롭다운)을 누른 것이면 지도 조작이 아니다.
      if (isOverlayEvent(e)) return
      e.preventDefault()
      // 사각형/선분 그리기 모드에서는 같은 좌클릭 드래그가 팬 대신 도형 그리기가 된다.
      // 점은 클릭 한 번, 폴리곤은 클릭마다 점 추가이므로(handleMouseUp) 여기서는 평소의
      // 팬/클릭 경로를 그대로 탄다.
      if (OBSTACLE_DRAG_SHAPES.includes(drawObstacleShapeRef.current)) {
        const point = canvasPointOf(e)
        obstacleDraftRef.current = {
          shape: drawObstacleShapeRef.current,
          x0: point.x,
          y0: point.y,
          x1: point.x,
          y1: point.y
        }
        // 누른 지점이 첫 좌표다 — 끌기 전에도 시작점이 조작 줄에 보여야 한다.
        const start = canvasToWorld(point.x, point.y)
        if (start) setDraftPointsIfChanged([start])
        return
      }
      // 편집 중인 도형의 꼭지점/회전 손잡이를 집었으면 크기 조절/회전/점 옮기기다. 밖을 누르면
      // 평소처럼 팬이므로 편집 중에도 지도를 옮겨 가며 고칠 수 있다.
      if (obstacleHandlesRef.current.length > 0) {
        const point = canvasPointOf(e)
        const handleHit = obstacleHandleAt(point)
        if (handleHit?.rotate) {
          obstacleRotateRef.current = {
            id: handleHit.id,
            center: handleHit.center,
            corners: handleHit.corners,
            startAngle: Math.atan2(point.y - handleHit.center.py, point.x - handleHit.center.px)
          }
          wrapper.style.cursor = 'grab'
          return
        }
        if (handleHit) {
          obstacleResizeRef.current = handleHit
          wrapper.style.cursor = 'nwse-resize'
          return
        }
      }
      // startX/Y 는 클릭 판정(이동 거리)과 말풍선 위치 계산에 쓰므로 드래그 중에도 유지한다.
      dragRef.current = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }
      wrapper.style.cursor = 'grabbing'
    }

    const handleMouseMove = (e) => {
      const draft = obstacleDraftRef.current
      if (draft) {
        const point = canvasPointOf(e)
        obstacleDraftRef.current = { ...draft, x1: point.x, y1: point.y }
        // 사각형은 두 대각 꼭지점이 아니라 네 꼭지점을 보여준다 — 저장되는 좌표와 같아야 한다.
        const start = canvasToWorld(draft.x0, draft.y0)
        const end = canvasToWorld(point.x, point.y)
        if (start && end) {
          setDraftPointsIfChanged(
            draft.shape === OBSTACLE_SHAPE_LINE ? [start, end] : rectFromWorldPoints(start, end).points
          )
        }
        renderRef.current()
        return
      }

      // 회전 손잡이를 끄는 중 — 드래그 시작 시점의 네 꼭지점을, 중심 기준으로 지금까지 돌린
      // 각도만큼 그대로 회전시켜 새 좌표로 올려보낸다(캔버스 픽셀 기준 회전 후 월드로 환산).
      const rotate = obstacleRotateRef.current
      if (rotate) {
        const point = canvasPointOf(e)
        const angle = Math.atan2(point.y - rotate.center.py, point.x - rotate.center.px)
        const delta = angle - rotate.startAngle
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        const worldPoints = rotate.corners
          .map((corner) => {
            const dx = corner.px - rotate.center.px
            const dy = corner.py - rotate.center.py
            const world = canvasToWorld(rotate.center.px + dx * cos - dy * sin, rotate.center.py + dx * sin + dy * cos)
            // canvasToWorld 는 x,y 만 돌려준다 — BE(map_obstacles.points)가 기대하는 {x,y,z}
            // 3요소를 여기서 채워야 회전 뒤 저장 시 z 가 빠지지 않는다.
            return world && { ...world, z: OBSTACLE_POINT_Z }
          })
          .filter(Boolean)
        if (worldPoints.length === 4) {
          onObstacleResizeRef.current?.(rotate.id, { shape: OBSTACLE_SHAPE_RECTANGLE, points: worldPoints })
        }
        return
      }

      // 꼭지점을 끄는 중 — 좌표를 곧바로 올려보낸다(목록의 좌표와 지도가 같이 따라온다).
      // 사각형은 드래그 시작 시점의 네 꼭지점(corners)에서 지금의 회전을 유지한 채 대각선
      // 반대 꼭지점을 고정하고 다시 만들고, 폴리곤은 그 점만 옮긴다.
      const resize = obstacleResizeRef.current
      if (resize) {
        const point = canvasPointOf(e)
        if (resize.index != null) {
          const world = canvasToWorld(point.x, point.y)
          if (world) onObstacleVertexMoveRef.current?.(resize.id, resize.index, world)
          return
        }
        const canvasCorners = resizeRotatedRectCorners(resize.corners, resize.fixedIndex, point)
        // canvasToWorld 는 x,y 만 돌려준다 — BE(map_obstacles.points)가 기대하는 {x,y,z} 3요소를
        // 여기서 채워야 리사이즈 뒤 저장 시 z 가 빠지지 않는다.
        const worldPoints = canvasCorners
          .map((corner) => canvasToWorld(corner.px, corner.py))
          .filter(Boolean)
          .map((world) => ({ ...world, z: OBSTACLE_POINT_Z }))
        if (worldPoints.length === 4) {
          onObstacleResizeRef.current?.(resize.id, { shape: OBSTACLE_SHAPE_RECTANGLE, points: worldPoints })
        }
        return
      }

      const drag = dragRef.current
      if (!drag) {
        // 누르지 않고 지나가는 중.
        // 폴리곤을 찍는 중이면 마지막 점에서 커서까지 고무줄을 이어 다음 변을 보여준다.
        if (drawObstacleShapeRef.current === OBSTACLE_SHAPE_POLYGON && polygonDraftRef.current?.points?.length) {
          const point = canvasPointOf(e)
          polygonDraftRef.current = { ...polygonDraftRef.current, cursor: { px: point.x, py: point.y } }
          renderRef.current()
          return
        }
        // 편집 중인 꼭지점/회전 손잡이 위에서는 커서로 잡을 수 있음을 알린다.
        if (obstacleHandlesRef.current.length > 0 && !drawObstacleShapeRef.current) {
          const hit = obstacleHandleAt(canvasPointOf(e))
          wrapper.style.cursor = hit?.rotate ? 'grab' : hit ? 'nwse-resize' : 'grab'
        }
        return
      }
      const view = viewRef.current
      view.tx += e.clientX - drag.x
      view.ty += e.clientY - drag.y
      const moved =
        drag.moved || Math.abs(e.clientX - drag.startX) > CLICK_SLOP || Math.abs(e.clientY - drag.startY) > CLICK_SLOP
      dragRef.current = { ...drag, x: e.clientX, y: e.clientY, moved }
      userAdjustedRef.current = true
      clampView()
      renderRef.current()
    }

    const handleMouseUp = () => {
      // 가상 장애물 사각형/선분 확정 — 드래그를 놓은 시점의 두 점을 월드 좌표로 바꿔 올려보낸다.
      const draft = obstacleDraftRef.current
      if (draft) {
        obstacleDraftRef.current = null
        // 도형이 확정되면(또는 버려지면) 진행 중 좌표는 더 이상 진행 중이 아니다 —
        // 확정된 좌표는 모달이 이어서 보여준다.
        setObstacleDraftPoints([])
        renderRef.current()
        // 너무 작은 드래그는 그리기 모드에서 잘못 누른 것으로 보고 버린다.
        // 사각형은 두 변이 모두 있어야 하고(넓이 0 금지), 선분은 길이만 있으면 된다.
        const dx = Math.abs(draft.x1 - draft.x0)
        const dy = Math.abs(draft.y1 - draft.y0)
        const tooSmall =
          draft.shape === OBSTACLE_SHAPE_LINE
            ? Math.hypot(dx, dy) < OBSTACLE_MIN_DRAG_PX
            : dx < OBSTACLE_MIN_DRAG_PX || dy < OBSTACLE_MIN_DRAG_PX
        if (tooSmall) return

        const handleDrawn = onObstacleDrawnRef.current
        if (!handleDrawn) return
        const start = canvasToWorld(draft.x0, draft.y0)
        const end = canvasToWorld(draft.x1, draft.y1)
        if (!start || !end) return
        if (draft.shape === OBSTACLE_SHAPE_LINE) {
          // 선분은 끈 방향을 그대로 둔다 — 시작/끝 순서가 곧 저장되는 점 순서다.
          handleDrawn(shapeFromWorldPoints(OBSTACLE_SHAPE_LINE, [start, end]))
          return
        }
        // 사각형은 어느 방향으로 끌었는지와 무관하게 같은 꼭지점 순서(좌상→우상→우하→좌하)로 만든다.
        handleDrawn(rectFromWorldPoints(start, end))
        return
      }

      // 회전/모서리 끌기 종료 — 좌표는 이동 중에 이미 반영했으므로 여기서는 상태만 푼다.
      if (obstacleRotateRef.current) {
        obstacleRotateRef.current = null
        wrapper.style.cursor = 'grab'
        return
      }
      if (obstacleResizeRef.current) {
        obstacleResizeRef.current = null
        wrapper.style.cursor = 'grab'
        return
      }

      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      wrapper.style.cursor = 'grab'

      // 팬이었으면 뷰가 바뀐 것만 알리고, 제자리 클릭이면 월드 좌표로 바꿔 올려보낸다.
      if (drag.moved) {
        onViewChangeRef.current?.()
        return
      }

      const rect = (canvasRef.current ?? wrapper).getBoundingClientRect()
      const canvasX = drag.startX - rect.left
      const canvasY = drag.startY - rect.top

      // 점(POINT) 그리기 모드 — 제자리 클릭 한 번이 곧 도형 확정이다(드래그는 평소처럼 팬).
      if (drawObstacleShapeRef.current === OBSTACLE_SHAPE_POINT) {
        const world = canvasToWorld(canvasX, canvasY)
        if (!world) return
        onObstacleDrawnRef.current?.(shapeFromWorldPoints(OBSTACLE_SHAPE_POINT, [world]))
        return
      }

      // 폴리곤을 찍는 중이면 제자리 클릭은 점 추가다(이동 말풍선은 뜨지 않는다).
      // 찍은 점이 3개 이상이고 첫 점을 다시 눌렀으면 그것으로 닫는다.
      if (drawObstacleShapeRef.current === OBSTACLE_SHAPE_POLYGON) {
        const first = polygonDraftHitsRef.current[0]
        const points = polygonDraftRef.current?.points ?? []
        if (
          first &&
          points.length >= OBSTACLE_POLYGON_MIN_POINTS &&
          Math.hypot(first.px - canvasX, first.py - canvasY) <= OBSTACLE_POLYGON_CLOSE_HIT_PX
        ) {
          commitPolygonDraft()
          return
        }
        const world = canvasToWorld(canvasX, canvasY)
        if (!world) return
        const next = [...points, world]
        polygonDraftRef.current = { points: next, cursor: { px: canvasX, py: canvasY } }
        setDraftPointsIfChanged(next)
        renderRef.current()
        return
      }

      const handler = onMapClickRef.current
      if (!handler) return

      // 먼저 POI 를 집었는지 본다 — 겹쳐 있으면 클릭 지점에 가장 가까운 하나만 고른다.
      const hit = poiHitsRef.current.reduce((best, candidate) => {
        const distance = Math.hypot(candidate.px - canvasX, candidate.py - canvasY)
        if (distance > POI_HIT_RADIUS_PX) return best
        return !best || distance < best.distance ? { ...candidate, distance } : best
      }, null)
      if (hit) {
        const position = hit.poi.pose.position
        handler({ x: position.x, y: position.y, canvasX: hit.px, canvasY: hit.py, poi: hit.poi })
        return
      }

      const world = canvasToWorld(canvasX, canvasY)
      if (world) handler({ ...world, canvasX, canvasY, poi: null })
    }

    // 더블클릭 → 전체보기로 초기화.
    // 폴리곤을 찍는 중에는 막는다 — 점을 빠르게 두 번 찍으면 더블클릭으로 잡혀 뷰가 튄다.
    const handleDoubleClick = (e) => {
      // 조작 줄을 두 번 눌렀다고 전체보기로 돌아가면 안 된다.
      if (isOverlayEvent(e)) return
      if (drawObstacleShapeRef.current === OBSTACLE_SHAPE_POLYGON) return
      const canvas = canvasRef.current
      const { w, h } = gridSizeRef.current
      if (!canvas || !w || !h) return
      applyFit(canvas.width, canvas.height, w, h)
      userAdjustedRef.current = false
      renderRef.current()
      onViewChangeRef.current?.()
    }

    // 폴리곤 마무리 — 우클릭으로 닫는다(그리기 도구의 흔한 규약이고, 마우스만으로 끝낼 수 있다).
    // 폴리곤을 찍는 중에만 기본 컨텍스트 메뉴를 막는다 — 그 밖에서는 브라우저 메뉴를 그대로 둔다.
    const handleContextMenu = (e) => {
      // 조작 줄 위에서 우클릭한 것으로 폴리곤을 닫아 버리면 안 된다.
      if (isOverlayEvent(e)) return
      if (drawObstacleShapeRef.current !== OBSTACLE_SHAPE_POLYGON) return
      e.preventDefault()
      commitPolygonDraft()
    }

    // 폴리곤 마무리/취소 — Enter 로 닫고, Esc 로 찍던 점을 모두 버린다(모드는 유지된다).
    const handleKeyDown = (e) => {
      if (drawObstacleShapeRef.current !== OBSTACLE_SHAPE_POLYGON) return
      if (e.key === 'Enter') {
        commitPolygonDraft()
        return
      }
      if (e.key === 'Escape' && polygonDraftRef.current) {
        polygonDraftRef.current = null
        setObstacleDraftPoints([])
        renderRef.current()
      }
    }

    wrapper.addEventListener('wheel', handleWheel, { passive: false })
    wrapper.addEventListener('mousedown', handleMouseDown)
    wrapper.addEventListener('dblclick', handleDoubleClick)
    wrapper.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      wrapper.removeEventListener('wheel', handleWheel)
      wrapper.removeEventListener('mousedown', handleMouseDown)
      wrapper.removeEventListener('dblclick', handleDoubleClick)
      wrapper.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [wrapperEl, applyFit, clampView, canvasToWorld])

  // 가상 장애물 그리기 모드/형태 전환 — 커서로 지금 지도를 끌 수 없다는 것을 보여준다.
  // 모드를 끄거나 형태를 바꾸면 그리던 것은 버린다: 확정되지 않은 도형이 화면에 남으면 안 되고,
  // 사각형으로 바꿨는데 찍어 둔 폴리곤 점이 남아 있으면 안 된다(형태마다 점 개수 규칙이 다르다).
  // 조작 줄에 보여주던 좌표도 같은 이유로 함께 비운다.
  useEffect(() => {
    drawObstacleShapeRef.current = drawObstacleShape
    obstacleDraftRef.current = null
    polygonDraftRef.current = null
    setObstacleDraftPoints([])
    if (wrapperEl) wrapperEl.style.cursor = drawObstacleShape ? 'crosshair' : 'grab'
    renderRef.current()
  }, [drawObstacleShape, wrapperEl])

  // 편집 대상이 바뀌거나 편집이 끝나면 끌던 모서리를 놓는다 — 손잡이가 사라진 사각형을
  // 계속 늘이고 있으면 안 된다(손잡이 자체는 다음 render 가 대상에 맞춰 다시 채운다).
  useEffect(() => {
    obstacleResizeRef.current = null
  }, [editingObstacleId])

  /*
   * 지도 위 조작 줄(그리기 중 오버레이)과 지도 조작의 분리 — 전파를 끊지 않고 "대상" 으로 가린다.
   *
   * 조작 줄은 뷰포트의 자식이라 그 안을 눌러도 이벤트가 뷰포트까지 올라온다. 막지 않으면
   * 형태 드롭다운을 누르는 순간 그 자리가 좌표로 확정된다(점 모드는 클릭 한 번이 곧 도형이다).
   *
   * 그렇다고 조작 줄 노드에서 stopPropagation 을 하면 안 된다 — React 는 이벤트를 앱 루트에
   * 위임하므로(React 17+), 오버레이에서 전파를 끊으면 그 안에 있는 Dropdown 의 onClick 까지
   * 루트에 도달하지 못해 드롭다운이 아예 열리지 않는다.
   * 그래서 지도 쪽 네이티브 핸들러들이 isOverlayEvent(e) 로 대상만 걸러낸다(아래 포인터 effect).
   */

  const hasSpatialSubscription = subscribedTopics.some((t) => SPATIAL_TOPICS.includes(t))

  if (!hasSpatialSubscription) {
    return (
      <Placeholder>
        <PlaceholderText>시각화 가능한 토픽을 구독해주세요.</PlaceholderText>
      </Placeholder>
    )
  }

  const mapTopic = subscribedTopicOf(subscribedTopics, 'map')
  if (mapTopic && !mapData) {
    return (
      <Placeholder>
        {/* 토픽 이름은 노출하지 않는다 — 사용자가 기다리는 대상은 화면에 그려질 그리드맵이다. */}
        <PlaceholderText>그리드맵 수신 대기 중...</PlaceholderText>
      </Placeholder>
    )
  }

  return (
    <CanvasViewport
      ref={setWrapperNode}
      title={
        drawObstacleShape === OBSTACLE_SHAPE_POINT
          ? '클릭: 점 장애물 지정 · 드래그: 이동 · 휠: 확대/축소'
          : drawObstacleShape === OBSTACLE_SHAPE_LINE
            ? '드래그: 선분 장애물 지정 · 휠: 확대/축소'
            : drawObstacleShape === OBSTACLE_SHAPE_RECTANGLE
              ? '드래그: 가상 장애물 영역 지정 · 휠: 확대/축소'
              : drawObstacleShape === OBSTACLE_SHAPE_POLYGON
                ? '클릭: 점 추가 · 우클릭/Enter/첫 점 클릭: 닫기 · Esc: 다시 찍기 · 드래그: 이동'
                : editingObstacleId != null
                  ? '꼭지점 드래그: 모양 수정 · 그 밖 드래그: 이동 · 휠: 확대/축소'
                  : '휠: 확대/축소 · 드래그: 이동 · 더블클릭: 전체보기'
      }
    >
      <Canvas ref={canvasRef} />

      {/* 그리기 중 조작 줄 — 형태 선택과 "지금까지 찍은 좌표" 를 지도를 보면서 확인해야 하므로
          목록 패널이 아니라 지도 위에 겹친다. 지도 조작을 가로채지 않도록 드롭다운만
          pointer-events 를 되살린다(styles.js ObstacleDrawBarRow 참고).
          data-obstacle-overlay 는 지도 포인터 핸들러가 "조작 줄에서 난 이벤트" 를 알아보는 표시다
          — 전파를 끊지 않고 대상으로 거르는 이유는 위 주석(React 이벤트 위임) 참고. */}
      {drawObstacleShape && (
        <ObstacleDrawBar data-obstacle-overlay>
          <ObstacleDrawBarRow>
            {obstacleShapeOptions.length > 0 && onObstacleShapeChange && (
              <div className="control">
                <Dropdown
                  label={obstacleShapeLabel}
                  size="sm"
                  minWidth="14rem"
                  value={drawObstacleShape}
                  options={obstacleShapeOptions}
                  onChange={onObstacleShapeChange}
                />
              </div>
            )}
            {obstacleDrawHint && <ObstacleDrawPanel>{obstacleDrawHint}</ObstacleDrawPanel>}
          </ObstacleDrawBarRow>

          {/* 찍은 좌표 — 점이 하나라도 생긴 뒤에만 띄운다(빈 판이 지도를 가리지 않게).
              표기는 목록/모달과 같은 소수 두 자리다. */}
          {obstacleDraftPoints.length > 0 && (
            <ObstacleDrawPanel>
              <span className="title">{obstaclePointsLabel}</span>
              <div className="points">
                {obstacleDraftPoints.map((point, index) => (
                  <span key={index}>{`${index + 1}. [ ${point.x.toFixed(2)}, ${point.y.toFixed(2)} ]`}</span>
                ))}
              </div>
            </ObstacleDrawPanel>
          )}
        </ObstacleDrawBar>
      )}
    </CanvasViewport>
  )
}

const MemoizedMapCanvas = React.memo(MapCanvas, (prevProps, nextProps) => {
  if (prevProps.mapData !== nextProps.mapData) return false
  if (prevProps.scanData !== nextProps.scanData) return false
  if (prevProps.odomData !== nextProps.odomData) return false
  if (prevProps.robotPose !== nextProps.robotPose) return false
  // 보정량이 갱신되면(루프 클로저 등) 궤적을 다시 그려야 한다.
  if (prevProps.frameCorrections !== nextProps.frameCorrections) return false
  if (prevProps.showScan !== nextProps.showScan) return false
  // POI 목록은 편집(생성/수정/삭제 예정)마다 새 배열이 오므로 레퍼런스 비교로 충분하다.
  if (prevProps.pois !== nextProps.pois) return false
  // 가상 장애물도 추가/삭제마다 새 배열이 온다.
  if (prevProps.obstacles !== nextProps.obstacles) return false
  if (prevProps.drawObstacleShape !== nextProps.drawObstacleShape) return false
  if (prevProps.selectedObstacleId !== nextProps.selectedObstacleId) return false
  if (prevProps.editingObstacleId !== nextProps.editingObstacleId) return false
  // 지도 위 조작 줄 — 형태별로 문구가 바뀌므로 함께 본다. options 는 부모가 useMemo 로
  // 고정해 넘기므로(SemanticPage) 레퍼런스 비교로 충분하다.
  if (prevProps.obstacleShapeOptions !== nextProps.obstacleShapeOptions) return false
  if (prevProps.obstacleShapeLabel !== nextProps.obstacleShapeLabel) return false
  if (prevProps.obstacleDrawHint !== nextProps.obstacleDrawHint) return false
  if (prevProps.obstaclePointsLabel !== nextProps.obstaclePointsLabel) return false
  if (prevProps.onObstacleShapeChange !== nextProps.onObstacleShapeChange) return false
  if (prevProps.subscribedTopics !== nextProps.subscribedTopics) return false
  // 콜백은 ref 로 최신값을 쓰지만, 부모가 새 함수를 넘기면 리스너 재등록이 필요할 수 있어 함께 본다.
  if (prevProps.onMapClick !== nextProps.onMapClick) return false
  if (prevProps.onViewChange !== nextProps.onViewChange) return false
  if (prevProps.onObstacleDrawn !== nextProps.onObstacleDrawn) return false
  if (prevProps.onObstacleResize !== nextProps.onObstacleResize) return false
  if (prevProps.onObstacleVertexMove !== nextProps.onObstacleVertexMove) return false

  // Check spatial keys in customTopicsData
  const spatialKeys = [
    '/scan_matched_points2',
    '/lio/path',
    '/trajectory_node_list',
    '/landmark_poses_list',
    '/goal_pose',
    '/initialpose',
    '/clicked_point',
    '/tf',
    '/tf_static',
    ...FOOTPRINT_TOPICS
  ]

  for (const key of spatialKeys) {
    if (prevProps.customTopicsData[key] !== nextProps.customTopicsData[key]) {
      return false
    }
  }

  return true
})

export default MemoizedMapCanvas
