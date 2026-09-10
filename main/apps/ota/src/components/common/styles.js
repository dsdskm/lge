import styled, { keyframes, css } from 'styled-components'

export const DropdownContainer = styled.div`
  display: flex;
  gap: 2rem;
  margin-bottom: 2rem;
`

export const ButtonWrap = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;

  &.alignLeft {
    justify-content: flex-start;
  }

  &.alignRight {
    justify-content: flex-end;
  }

  &.alignCenter {
    justify-content: center;
  }
`

export const PageHeadWrap = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  width: 100%;
  margin: 0 auto 2rem auto;

  & > div:first-child {
    font-weight: bold;
  }

  ${ButtonWrap} {
    margin: 0;
  }
`

// 상세/생성 화면 헤더 : 좌측 타이틀(+조직명), 우측 액션 버튼
export const DetailHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
  width: 100%;
  margin-bottom: 2.4rem;

  .titleGroup {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .orgName {
    color: var(--color-secondary-60);
  }

  ${ButtonWrap} {
    margin: 0;
  }
`

export const slideDown = keyframes`
  from {
    opacity: 0;
    margin-top: -1.0rem;
  }
  to {
    opacity: 1;
    margin-top: 0;
  }
`

export const slideUp = keyframes`
  from {
    opacity: 1;
    margin-top: 0;
  }
  to {
    opacity: 0;
    margin-top: -1.0rem;
  }
`

export const StyledExpandedWrapper = styled.div`
  animation: ${({ $isClosing, $inModal }) =>
    $inModal
      ? 'none'
      : css`
          ${$isClosing ? slideUp : slideDown} 0.2s ease-out forwards
        `};
  overflow: hidden;
  padding: ${({ $inModal }) => ($inModal ? '0' : '1rem')};
  height: fit-content;
  background-color: ${({ $inModal }) => ($inModal ? 'transparent' : 'var(--color-neutral-30)')};
  border-radius: 0.5rem;
`

// 툴팁 앵커 : Icon 컴포넌트는 추가 props를 svg로 전달하지 않으므로
// data-tooltip-* 속성은 이 래퍼가 들고 있어야 react-tooltip이 인식한다
export const StyledInfoAnchor = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: 0.4rem;
  color: var(--color-secondary-60);
  cursor: help;
  vertical-align: middle;

  &:hover {
    color: var(--color-secondary-80);
  }
`
