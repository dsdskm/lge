import styled from 'styled-components'

/** 업데이트 주기 조절 묶음 — 알약형으로 툴바 오른쪽 줄을 정돈한다. */
export const FpsControl = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
  padding: 0.4rem 1.4rem;
  border: 1px solid var(--color-secondary-20);
  border-radius: 100px;
  background: var(--color-neutral-10);
  white-space: nowrap;
  cursor: pointer;

  & > .label {
    color: var(--color-neutral-60);
    font-size: var(--font-size-body-6);
    line-height: var(--line-height-body-6);
    letter-spacing: 0.04em;
  }

  /* 드래그하는 동안 자릿수가 바뀌어도(9 → 10 Hz) 슬라이더가 밀리지 않게
     고정폭 숫자 + 최소 너비로 잡아 둔다. */
  & > .value {
    min-width: 4.8rem;
    color: var(--color-neutral-80);
    font-size: var(--font-size-body-6);
    line-height: var(--line-height-body-6);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
`

/**
 * FPS 슬라이더.
 *
 * 강조색은 테마 토큰(--t-toggle-active-bg)을 쓴다 — 테마를 바꿀 수 있는 앱이라
 * (packages/ui/styles/vars.css 의 [data-theme='legacy']) 색을 직접 박으면 한쪽 테마에서 뜬다.
 * 채운 구간은 Chromium 이 ::-webkit-slider-runnable-track 에 progress 를 주지 않으므로
 * 배경 그라디언트로 그리고, Firefox 는 ::-moz-range-progress 로 같은 모양을 만든다.
 */
export const FpsSlider = styled.input`
  -webkit-appearance: none;
  appearance: none;
  width: 12rem;
  height: 0.6rem;
  margin: 0;
  background: ${({ $percentage }) =>
    `linear-gradient(
      to right,
      var(--t-toggle-active-bg) 0%,
      var(--t-toggle-active-bg) ${$percentage}%,
      var(--color-secondary-20) ${$percentage}%,
      var(--color-secondary-20) 100%
    )`};
  border-radius: 100px;
  outline: none;
  cursor: pointer;

  /* 손잡이는 흰 테두리로 트랙에서 떼어 놓는다(작은 크기에서 가장 잘 읽히는 형태). */
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: var(--t-toggle-active-bg);
    border: 0.2rem solid var(--color-neutral-10);
    box-shadow: var(--shadow-00);
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
  }

  &::-webkit-slider-thumb:hover {
    transform: scale(1.12);
  }

  &:focus-visible::-webkit-slider-thumb,
  &:active::-webkit-slider-thumb {
    /* 반투명 강조(halo)는 rgba 로 만들어야 해서 색 토큰의 rgb 짝을 쓴다. */
    box-shadow: 0 0 0 0.4rem rgba(var(--t-toggle-active-bg-rgb), 0.24);
  }

  &::-moz-range-track {
    height: 0.6rem;
    background: var(--color-secondary-20);
    border-radius: 100px;
  }

  &::-moz-range-progress {
    height: 0.6rem;
    background-color: var(--t-toggle-active-bg);
    border-radius: 100px 0 0 100px;
  }

  &::-moz-range-thumb {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: var(--t-toggle-active-bg);
    border: 0.2rem solid var(--color-neutral-10);
    box-shadow: var(--shadow-00);
    cursor: pointer;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
  }

  &::-moz-range-thumb:hover {
    transform: scale(1.12);
  }

  &:focus-visible::-moz-range-thumb,
  &:active::-moz-range-thumb {
    box-shadow: 0 0 0 0.4rem rgba(var(--t-toggle-active-bg-rgb), 0.24);
  }
`

// Section(카드) 안에 놓이는 툴바다 — 배경/좌우 여백은 Section 이 이미 갖고 있어서
// 아래쪽 구분선과 그만큼의 여백만 남긴다.
export const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding-bottom: 1.2rem;
  border-bottom: 1px solid var(--color-secondary-20);
`

// 매핑 조작 버튼(시작 · 저장 · 재시작) 묶음 — 툴바 오른쪽 끝에 붙인다.
export const MappingActions = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-left: auto;
`
