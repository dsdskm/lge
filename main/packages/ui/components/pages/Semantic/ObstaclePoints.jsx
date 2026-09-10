import { ObstaclePointGrid } from './styles'

/**
 * 좌표 한 점의 표기 — 목록 / 모달 / 지도 위 조작 줄이 모두 같은 자리수를 쓴다.
 * 소수 두 자리는 cm 단위다(지도 해상도가 보통 5 cm 라 그보다 잘게 보여줄 이유가 없다).
 * z 는 지금은 항상 0.0 고정값이지만(평면 도형), 저장되는 값과 화면이 다르게 보이면
 * "왜 z 가 없냐"는 문의가 생기므로 실제로 저장되는 3요소를 그대로 보여준다.
 */
export const pointText = (point) =>
  point && typeof point.x === 'number' && typeof point.y === 'number'
    ? `[ ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${(typeof point.z === 'number' ? point.z : 0).toFixed(2)} ]`
    : ''

/**
 * 가상 장애물의 꼭지점 목록.
 *
 * 찍은 순서대로 번호를 붙여 보여준다 — 폴리곤에서는 점 순서가 곧 변의 순서라
 * (로봇의 내부 판정도 순서에 의존한다) 순서 없이 좌표만 늘어놓으면 확인할 수 없다.
 * 칸 폭을 넘으면 다음 줄로 내려간다.
 *
 * @param {Array<{x: number, y: number, z?: number}>} points
 */
const ObstaclePointList = ({ points = [] }) => (
  <ObstaclePointGrid>
    {points.map((point, index) => (
      <span key={index}>
        {index + 1}. {pointText(point)}
      </span>
    ))}
  </ObstaclePointGrid>
)

export default ObstaclePointList
