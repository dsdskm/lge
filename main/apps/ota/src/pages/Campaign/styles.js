import styled from 'styled-components'

export const DropdownContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
  margin-bottom: 2rem;
`

// 상세 화면 카드 그리드 : 상단(캠페인 정보 / 업데이트 상태), 하단(타겟 그룹 / 아티팩트 / 롤아웃 설정)
export const DetailCardRow = styled.div`
  display: grid;
  grid-template-columns: ${({ $columns }) => $columns || '1fr'};
  align-items: stretch;
  gap: 2rem;
  width: 100%;
  margin-bottom: 2rem;

  @media all and (max-width: 1280px) {
    grid-template-columns: 1fr;
  }
`

// label - value 형태의 읽기 전용 정보 목록
export const InfoList = styled.dl`
  display: grid;
  grid-template-columns: minmax(10rem, auto) 1fr;
  align-items: center;
  row-gap: 1.2rem;
  column-gap: 1.6rem;
  width: 100%;

  & > dt {
    color: var(--color-secondary-60);
  }

  & > dd {
    color: var(--color-neutral-80);
    font-weight: 600;
    word-break: break-all;
  }

  & .failedCount {
    margin-left: 0.4rem;
    color: var(--color-error-60);
    font-weight: 500;
  }
`

// 아티팩트 선택 필드 : 읽기 전용 입력 + 우측 검색 아이콘(클릭 시 선택 모달)
export const PickerField = styled.div`
  width: 100%;
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  pointer-events: ${({ $disabled }) => ($disabled ? 'none' : 'auto')};

  & input {
    cursor: inherit;
  }

  & .unit {
    display: inline-flex;
    align-items: center;
    color: var(--color-secondary-80);
  }
`

// 아티팩트 선택 모달 본문 : 필터 영역과 테이블 사이 간격 확보
export const ArtifactPickerBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2.4rem;
  width: 100%;
`

export const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  width: 100%;
`

// Rollout Schedule 입력 행 : 날짜 / 시간 / 타임존
export const ScheduleFieldRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 1.6rem;
  width: 100%;

  @media all and (max-width: 1280px) {
    grid-template-columns: 1fr;
  }

  // Calendar 컴포넌트는 label prop이 없어 여기서 라벨을 붙인다
  & .scheduleField {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
  }

  & .scheduleField > .fieldLabel {
    color: var(--color-secondary-60);
  }
`

// 섹션 제목 + 도움말 아이콘 (SectionTitle의 title에 노드로 전달)
export const TitleWithHelp = styled.span`
  display: inline-flex;
  align-items: center;
`

// 섹션 하단 안내 문구 (아이콘 + 텍스트)
export const SectionNotice = styled.p`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  color: var(--color-secondary-60);

  // 아이콘이 문구 앞에 오는 배치라 앵커의 좌측 여백은 필요 없다
  & > span:first-child {
    margin-left: 0;
  }
`

export const StateStatusList = styled.div`
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
  width: 100%;
  margin: 0 0 2.4rem;
`
