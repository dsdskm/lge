/**
 * 저장된 2D 격자맵 파일(grid_map.png + grid_map.yaml)을 MapCanvas 가 그릴 수 있는
 * OccupancyGrid 모양으로 바꾼다.
 *
 * 왜 필요한가 — /lio/grid_map 은 측위가 끝나는 시점(loading_grid_map → ready)에 한 번 발행되고
 * 끝이다. 그 뒤에 화면에 들어온 구독자(측위가 이미 끝난 로봇의 시맨틱 화면)는 아무 것도 받지
 * 못하므로 지도 칸이 빈 채로 남는다. 로봇에 재발행을 요청하는 경로는 쓰지 않고
 * (GET /robot-hub/save-map/grid-map 으로) 저장 파일을 받아 화면이 직접 그린다.
 *
 * 화소 → 점유값 변환은 nav2 map_server 의 규약을 그대로 따른다(loadMapFromFile):
 *   occ = negate ? gray/255 : (255 - gray)/255
 *   occ > occupied_thresh → 100(점유) / occ < free_thresh → 0(빈칸) / 그 사이 → 미탐색(-1)
 * threshold 는 로봇 설정에서 온 값이므로 yaml 에서 받은 것만 쓴다(추측하면 실제 지도와 달라진다).
 *
 * 행 순서도 map_server 와 같다 — 이미지의 첫 행이 지도의 가장 위(y 가 큰 쪽)이고
 * OccupancyGrid.data 는 왼쪽 아래(0,0)부터 채워지므로 세로로 뒤집어 넣는다.
 */

/** nav2 map_server 의 기본값 — yaml 에 값이 없을 때만 쓴다(mode/negate 는 선택 필드다). */
const DEFAULT_MODE = 'trinary'

/** yaml origin 은 [x, y, yaw] 다. MapCanvas 는 position 만 쓰지만 yaw 도 함께 채워 둔다. */
const originOf = (origin) => {
  const [x = 0, y = 0, yaw = 0] = Array.isArray(origin) ? origin : []
  return {
    position: { x, y, z: 0 },
    orientation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) }
  }
}

/** base64 이미지를 화소 버퍼로 푼다 — 디코딩은 브라우저에 맡긴다(png). */
const decodeImage = (base64, mime) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(image, 0, 0)
      resolve({
        width: canvas.width,
        height: canvas.height,
        pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data
      })
    }
    image.onerror = () => reject(new Error('Failed to decode grid map image'))
    image.src = `data:${mime};base64,${base64}`
  })

/**
 * 격자맵 파일 응답을 OccupancyGrid 모양으로 변환한다.
 *
 * @param {{image: {base64: string, mime: string}, meta: object|null}} gridMapFile
 *   GET /robot-hub/save-map/grid-map 응답의 data
 * @returns {Promise<{header: object, info: object, data: Int8Array}>}
 * @throws {Error} 디코딩 불가(png 가 아닌 형식) 또는 yaml 메타 부족(resolution 없음)
 */
export const toOccupancyGrid = async ({ image, meta } = {}) => {
  if (!image?.base64) throw new Error('grid map image is missing')
  // pgm 은 브라우저가 디코딩하지 못한다 — grid_map_node 의 save_format 기본값은 png 이므로
  // 여기까지 오는 경우는 로봇 설정을 바꾼 환경뿐이고, 그때는 지도를 그리지 않고 알린다.
  if (image.mime !== 'image/png') throw new Error(`unsupported grid map format: ${image.mime}`)
  // resolution 이 없으면 격자 크기를 알 수 없어 지도를 좌표계에 얹을 수 없다(추측하면 틀린 지도다).
  if (!meta?.resolution) throw new Error('grid map yaml has no resolution')

  const { width, height, pixels } = await decodeImage(image.base64, image.mime)

  const negate = Number(meta.negate) === 1
  const mode = meta.mode || DEFAULT_MODE
  const occupiedThresh = meta.occupied_thresh
  const freeThresh = meta.free_thresh
  if (typeof occupiedThresh !== 'number' || typeof freeThresh !== 'number') {
    throw new Error('grid map yaml has no occupied_thresh/free_thresh')
  }

  const data = new Int8Array(width * height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const pixelIndex = (row * width + col) * 4
      const alpha = pixels[pixelIndex + 3]
      // 이미지 첫 행 = 지도의 가장 위 → data 는 아래에서 위로 채운다.
      const cellIndex = (height - 1 - row) * width + col

      // 투명 화소는 미탐색이다(map_server 는 trinary 가 아닐 때만 알파를 본다).
      if (mode !== 'trinary' && alpha === 0) {
        data[cellIndex] = -1
        continue
      }

      const gray = (pixels[pixelIndex] + pixels[pixelIndex + 1] + pixels[pixelIndex + 2]) / 3
      const occ = negate ? gray / 255 : (255 - gray) / 255

      if (occ > occupiedThresh) {
        data[cellIndex] = 100
      } else if (occ < freeThresh) {
        data[cellIndex] = 0
      } else if (mode === 'scale') {
        // 중간값을 살리는 모드 — 1..99 로 눌러 담는다(0/100 은 확정값 몫이다).
        const span = occupiedThresh - freeThresh
        data[cellIndex] = span > 0 ? Math.round(1 + (98 * (occ - freeThresh)) / span) : -1
      } else {
        data[cellIndex] = -1
      }
    }
  }

  return {
    // 저장 파일에서 만든 지도이므로 시각(stamp)은 없다. 프레임은 측위가 끝난 뒤의 지도 프레임이다.
    header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' },
    info: {
      resolution: meta.resolution,
      width,
      height,
      origin: originOf(meta.origin)
    },
    data
  }
}
