import styled from 'styled-components'

/**
 * TaskFlowListRow 의 카드 룩(테두리·라운드·그림자)을 맞춘다.
 * $inactive: status 가 ACTIVE 가 아닌 Task. 배경을 눌러 "지금 쓰이지 않는다"를 드러낸다.
 * (클릭·편집은 그대로 되므로 pointer-events 는 건드리지 않는다)
 */
export const Card = styled.section<{ $inactive?: boolean }>`
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 74px;
  padding: 14px 20px;
  border: 1px solid ${({ $inactive }) => ($inactive ? '#e2e5ea' : '#d8dde6')};
  border-radius: 8px;
  background: ${({ $inactive }) => ($inactive ? '#f3f4f6' : '#ffffff')};
  box-shadow: ${({ $inactive }) =>
    $inactive
      ? 'none'
      : `0 1px 2px rgba(15, 23, 42, 0.05),
    0 3px 8px rgba(15, 23, 42, 0.06)`};
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    border-color: #b9c3d1;
  }
`

/** ACTIVE 가 아닌 상태(INACTIVE · DEPRECATED)를 알리는 뱃지. */
export const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #fcd34d;
  background: #fffbeb;
  color: #b45309;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
`

/** capability 색을 배경으로 쓰는 아이콘 사각형 */
export const IconBox = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: ${({ $color }) => $color};
`

export const CardMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
`

export const TitleRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
`

export const ActionName = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: #111827;
`

/** Action ID(코드)는 고정폭으로 보여준다. */
export const ActionIdText = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  color: #6b7280;
`

export const BuiltInBadge = styled.span`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  background: #f1f3f6;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
`

/**
 * 생성 위치 뱃지. "기본 제공" 뱃지와 같은 자리에 오므로 같은 치수를 쓴다.
 * (둘은 배타적이라 한 슬롯에 하나만 나타난다)
 */
export const LocationBadge = styled(BuiltInBadge)`
  gap: 4px;
`

export const DescRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
`

export const CapabilityTag = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  background: ${({ $color }) => `${$color}1f`};
  color: ${({ $color }) => $color};
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
`

/**
 * 연동 콘텐츠 태그(POI, MOTION 등).
 * content_reference 파라미터를 갖는 Task 임을 목록에서 바로 알 수 있게 표시한다.
 */
export const ContentTag = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
`

export const Desc = styled.span`
  font-size: 14px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const Chevron = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: #9ca3af;
`
