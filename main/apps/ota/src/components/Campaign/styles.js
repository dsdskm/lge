import styled from 'styled-components'

// Rollout Stage 표 : 셀 안에 입력 요소가 들어가므로 데이터 테이블 대신 직접 마크업한다
export const StageTable = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;

  th,
  td {
    padding: 1.2rem;
    text-align: left;
    vertical-align: middle;
    border-bottom: 1px solid var(--color-neutral-30);
  }

  thead th {
    color: var(--color-secondary-60);
    font-weight: 500;
    white-space: nowrap;
    background: var(--color-neutral-20);
    border-top: 1px solid var(--color-neutral-30);
  }

  & .colStage {
    width: 8rem;
  }

  & .colAddedRobots {
    width: 12rem;
  }

  & .colRemove {
    width: 6rem;
    text-align: center;
  }

  & .stageNo {
    color: var(--color-neutral-80);
    font-weight: 600;
  }

  & .addedRobots {
    color: var(--color-neutral-80);
    font-weight: 600;
  }

  // 운영자가 로봇을 직접 고른 단계 표시
  & .addedRobots .manualMark {
    display: block;
    color: var(--color-secondary-60);
    font-weight: 400;
  }

  // Target 값 + 단위(대수/%) 를 한 셀에 나란히 배치
  & .targetCell {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  & .targetCell > *:first-child {
    flex: 1 1 0;
    min-width: 0;
  }

  & .targetCell > *:last-child {
    flex: 0 0 12rem;
  }
`

// Rollout Stage 표 하단 : 단계 추가 버튼
export const StageTableFooter = styled.div`
  display: flex;
  justify-content: center;
  width: 100%;
  margin-top: 1.2rem;

  & > button {
    width: 100%;
  }
`

// 단계 표 아래 안내 문구 (미배정 로봇 알림 등)
export const StageNotice = styled.p`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  margin-top: 1.2rem;
  color: var(--color-secondary-60);

  & > span:first-child {
    margin-left: 0;
  }
`

// "Pause after each stage" 옵션 : 체크박스 + 권장 배지 + 설명 문구
export const PauseOption = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: 100%;
  margin-top: 1.6rem;

  & .optionHead {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  & .optionDesc {
    padding-left: 2.8rem;
    color: var(--color-secondary-60);
  }
`

// 배정 로봇 선택 모달 본문 : 상단 요약/검색 + 테이블
export const RobotPickerBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  width: 100%;

  & .assignedMark {
    color: var(--color-secondary-60);
  }
`

export const RobotPickerHead = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.6rem;
  width: 100%;

  & .selectedCount {
    color: var(--color-neutral-80);
    font-weight: 600;
    white-space: nowrap;
  }
`
