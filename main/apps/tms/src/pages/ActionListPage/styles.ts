import styled from 'styled-components'

/**
 * 검색과 필터 드롭다운을 한 줄에 놓고, 폭이 부족할 때만 줄바꿈한다.
 * 각 항목은 자기 폭을 지키고(flex-shrink: 0) 넘치면 다음 줄로 내려간다.
 */
export const ListControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;

  > * {
    flex: 0 0 auto;
  }

  @media all and (max-width: 767px) {
    width: 100%;
  }
`

export const ButtonWrap = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`

export const ListBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

export const TotalCount = styled.div`
  margin: 16px 0;
  font-size: 14px;
  font-weight: 700;
  color: #374151;
`
