import styled from 'styled-components'
import { StyledPageContent } from '@repo/ui'

// cms 콘텐츠 페이지와 같은 페이지 레이아웃(StyledPageContent > Title/LocationBar/Section).
// 다만 init-setup 은 App.jsx 에서 #mainContent 의 padding 을 제거했으므로(다른 페이지가
// 자체 여백을 갖는다) 이 페이지가 공용 레이아웃과 같은 여백을 직접 준다.
// 지도는 남은 높이를 모두 써야 해서 height: 100% 로 Section 이 늘어나게 한다.
export const StyledMapPageContent = styled(StyledPageContent)`
  height: 100%;
  padding: 20px;
`

// 위치 선택(좌) + 매핑 상태(우). LocationBar 가 자체 margin-bottom 을 갖고 있어 여백은 그대로 쓴다.
export const LocationRow = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.6rem;
  flex-wrap: wrap;
`

// 매핑 진행 상태(/lio_node/status). 매핑 중 여부를 멀리서도 알아볼 수 있어야 해서
// 토픽 상세 목록에서 떼어내 위치 선택 줄 오른쪽에 배지로 띄운다.
//
// $alert 는 "지금 조작을 막고 있는 상태" 를 뜻한다($active 의 강조와 구분해야 한다) —
// 비상정지 버튼이 눌려 있는 동안 그 배지만 경고색으로 띄워, 다른 상태 배지들 사이에서
// 원인을 바로 짚을 수 있게 한다.
export const MappingStatusBadge = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  flex-shrink: 0;
  margin-bottom: 2rem;
  padding: 0.8rem 1.6rem;
  border: 1px solid
    ${({ $active, $alert }) =>
      $alert ? 'var(--color-error-60)' : $active ? 'var(--color-primary-50)' : 'var(--color-secondary-20)'};
  border-radius: var(--radius-sm);
  background: ${({ $active, $alert }) =>
    $alert ? 'var(--color-error-15)' : $active ? 'var(--color-primary-10)' : 'var(--color-neutral-10)'};

  /* 글꼴/크기는 공용 typography 클래스(typographyBody5)를 쓰고 여기서는 색·굵기만 준다. */
  & > .label {
    color: var(--color-neutral-70);
    white-space: nowrap;
  }

  & > .value {
    color: ${({ $active, $alert }) =>
      $alert ? 'var(--color-error-70)' : $active ? 'var(--color-primary-50)' : 'var(--color-neutral-70)'};
    font-weight: 700;
    white-space: nowrap;
  }
`

// Semantic 페이지. SemanticPage 가 Section 들을 직접 내보내는데 공용 StyledPageContent 에는
// gap 이 없어 카드가 붙어 보이므로, Section 사이 간격을 페이지에서 준다.
export const StyledSemanticPageContent = styled(StyledMapPageContent)`
  gap: 1.6rem;

  /* 높이를 100% 로 묶지 않는다(StyledMapPageContent 상속값을 되돌린다) — POI 상세가 지도·목록
     아래에 열리면 내용이 화면보다 길어지는데, 높이가 고정이면 지도 칸이 짜부라지려 하고
     MapCanvas 는 최소 높이(400px)가 있어 줄지 못해 Section 밖으로 삐져나와 상세와 겹친다.
     min-height 로 두면 상세가 닫힌 동안에는 지도가 화면을 꽉 채우고(workspace 가 flex-grow),
     열리면 페이지가 늘어나 #mainContent(overflow-y: auto)가 스크롤한다. */
  height: auto;
  min-height: 100%;
`

// 편집 대상이 정해지기 전(위치 미선택 / 해당 위치에 맵 없음) Section 안에 띄우는 안내 문구.
export const EmptyMessage = styled.p`
  padding: 4rem 0;
  text-align: center;
  color: var(--color-neutral-70);
`

// Map(스캔) 화면의 위치 선택 줄 오른쪽 묶음 — 상태 배지들만 담는다.
// LocationRow 가 space-between 이라 배지를 개별 자식으로 두면 가운데로 벌어진다 — 묶어서 오른쪽에 붙인다
// (LocationBar 가 줄바꿈될 때도 오른쪽 정렬이 유지되도록 margin-left: auto 를 함께 준다).
// Semantic 화면에서는 이 컴포넌트를 쓰지 않는다 — 아래 MapControlsGroup/StatusGroup 참고.
export const BadgeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 1.6rem;
  flex-wrap: wrap;
  margin-left: auto;

  @media (max-width: 1280px) {
    justify-content: flex-end;
  }
`

// Semantic 화면 전용 — 맵 선택 Dropdown 과 ActionGroup(조작 버튼)을 한 묶음으로 묶어 LocationRow의
// 첫 자식으로 둔다. 조작 버튼이 Dropdown 바로 옆에 붙게 하려는 목적이라(요청 전에는 BadgeRow 가
// Dropdown 과 멀찍이 떨어진 오른쪽 끝에 버튼+배지를 함께 밀어 두고 있었다), 오른쪽으로 미는
// margin-left 는 주지 않는다 — 오른쪽 정렬은 StatusGroup(아래) 이 LocationRow의 space-between으로 맡는다.
export const MapControlsGroup = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 1.6rem;
  flex-wrap: wrap;
`

// 조작 버튼 묶음(맵 로드 · 회전/정지 · 이동 정지 · 장애물 반영) — MapControlsGroup 안에서 Dropdown 다음에 온다.
export const ActionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;

  /* 태블릿 폭에서는 손가락으로 누르기 쉽도록 버튼 높이를 키운다. */
  @media (max-width: 1280px) {
    & > button {
      min-height: 4.4rem;
    }
  }
`

// Semantic 화면의 상태 배지 묶음(비상정지 · 회전 진행 · 맵 로드/측위 · 주행) — LocationRow의 마지막
// 자식으로 두어 margin-left: auto 로 오른쪽 끝에 붙인다. 배지가 4개로 늘면서 세로 1열로 쌓으면
// 옆의 컨트롤(맵 선택 · 버튼)보다 훨씬 높아져 가운데에 빈 공간이 커 보였다 — 2열 그리드로 접어
// 세로 높이를 절반으로 줄인다. 각 열은 그 열에서 가장 넓은 배지에 맞춰 자동으로 너비가 맞춰지므로
// (grid-auto-columns) 배지마다 텍스트 길이가 달라도 열 안에서는 좌우가 들쭥날쭥하지 않는다.
export const StatusGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 0.8rem;
  margin-left: auto;

  /* MappingStatusBadge 는 Map(스캔) 화면과 공유하는 컴포넌트라 자체 margin-bottom(2rem)을 갖는다
     (그 화면에서는 위치 선택 줄과의 아래선을 맞추기 위한 값). 여기서는 그룹 자체가 그리드로 배치되므로
     그 여백은 지운다. */
  & > div {
    margin-bottom: 0;
  }
`

// Semantic 지도 칸 — 캔버스 위에 이동 말풍선을 겹치기 위한 기준 컨테이너.
// MapCanvas 의 래퍼가 flex:1 로 늘어나므로 여기서도 flex 를 유지한다.
export const MapClickArea = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
`

// 지도 클릭 위치에 뜨는 말풍선. 클릭 지점(canvasX/Y) 바로 위에 꼬리를 두고 가운데 정렬한다.
// 지도 경계에서 잘리지 않도록 좌우는 clamp 로 캔버스 안쪽에 붙여 둔다.
export const NavBubble = styled.div`
  position: absolute;
  left: clamp(9rem, ${({ $x }) => `${$x}px`}, calc(100% - 9rem));
  top: ${({ $y }) => `${$y}px`};
  transform: translate(-50%, calc(-100% - 1.2rem));
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1.2rem;
  border: 1px solid var(--color-secondary-20);
  border-radius: var(--radius-sm);
  background: var(--color-neutral-10);
  box-shadow: 0 0.4rem 1.2rem rgba(0, 0, 0, 0.18);
  white-space: nowrap;

  /* 말풍선 꼬리 — 클릭 지점을 가리킨다. */
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -0.7rem;
    width: 1.2rem;
    height: 1.2rem;
    transform: translateX(-50%) rotate(45deg);
    border-right: 1px solid var(--color-secondary-20);
    border-bottom: 1px solid var(--color-secondary-20);
    background: var(--color-neutral-10);
  }

  /* POI 마커를 집었을 때만 나오는 POI 이름 — 좌표보다 먼저 읽혀야 한다. */
  & > .poiName {
    color: var(--color-primary-50);
    font-weight: 700;
  }

  & > .coords {
    color: var(--color-neutral-80);
    font-weight: 700;
  }

  & > .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
`

// 좌: 지도 Section(남는 폭 전부) / 우: StatusPanel(자체 고정폭 열, 내부에 Section 3개).
export const MapWorkspace = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 1.6rem;

  & > section {
    min-width: 0;
  }
`
