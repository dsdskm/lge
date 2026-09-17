import styled from 'styled-components'

/**
 * 상세/편집 공통 컨테이너.
 * 배경·패딩을 두지 않는다 — 로봇 상세 화면처럼 MainLayout 의 여백 위에 카드만 얹히는 모양을 따른다.
 */
export const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`

export const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`

export const HeaderButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

/**
 * 제목 줄에 들어가는 아이콘 사각형.
 * Title 의 <h2> 안에 들어가므로 div 가 아니라 span 으로 만든다(h2 는 phrasing content 만 허용).
 */
/** capability 아이콘. 기본 정보 영역에서 skill 이름 앞에 붙인다. */
export const CapabilityIconBox = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: ${({ $color }) => $color};
`

export const Card = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
`

export const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
`

export const CardTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #374151;
`

/** INPUT / OUTPUT 구분 배지 */
export const SectionBadge = styled.span<{ $tone: 'input' | 'output' }>`
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: ${({ $tone }) => ($tone === 'input' ? '#eff6ff' : '#ecfdf5')};
  color: ${({ $tone }) => ($tone === 'input' ? '#2563eb' : '#059669')};
`

export const CountBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
`

export const CardHeaderRight = styled.div`
  margin-left: auto;
`

export const CardBody = styled.div`
  padding: 12px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

/** 파라미터 표(보기 모드) */
export const ParamTable = styled.table`
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: 10px 16px;
    font-size: 14px;
    text-align: left;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: middle;
  }

  th {
    font-weight: 600;
    color: #6b7280;
    background: #ffffff;
  }

  td {
    color: #374151;
  }

  tr:last-child td {
    border-bottom: none;
  }
`

/**
 * 파라미터 목록 표. 기본 정보 표(ParamTable)와 달리 열이 5개라 좁은 화면에서 읽을 수 없다.
 * 모바일에서는 행을 블록으로 풀어 "라벨: 값" 형태로 세운다.
 *
 * 라벨은 CSS 에 넣을 수 없으므로(번역이 필요하다) 각 td 의 data-label 을 읽어 쓴다.
 */
export const ParamListTable = styled(ParamTable)`
  @media all and (max-width: 767px) {
    thead {
      display: none;
    }

    /* 가로 여백은 행이 갖는다. 데스크톱 셀(padding 0 16px)과 같은 들여쓰기를 유지한다. */
    tr {
      display: block;
      padding: 10px 16px;
      border-bottom: 1px solid #f3f4f6;
    }

    tr:last-child {
      border-bottom: none;
    }

    td {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 4px 0;
      border-bottom: none;
    }

    td::before {
      content: attr(data-label);
      flex: 0 0 84px;
      color: #6b7280;
      font-weight: 600;
    }

    /* 값이 빈 칸은 줄만 차지하므로 숨긴다. */
    td:empty {
      display: none;
    }
  }
`

/** 편집 폼에서 수정할 수 없는 값(생성 위치 등)을 입력창과 같은 높이로 보여준다. */
export const ReadOnlyValue = styled.div`
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  color: #4b5563;
  font-size: 14px;
`

/** 표 칸 안에서 칩·텍스트를 나란히 둘 때 간격을 주는 묶음. */
export const ChipGroup = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`

/** 파라미터 타입. 코드 값이라 고정폭으로만 보여주고 뱃지는 씌우지 않는다. */
export const TypeText = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  color: #4b5563;
  word-break: break-all;
`

export const TypeChip = styled.span`
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  background: #f3f4f6;
  color: #4b5563;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
`

export const RequiredText = styled.span<{ $required?: boolean }>`
  color: ${({ $required }) => ($required ? '#dc2626' : '#9ca3af')};
  font-size: 13px;
  font-weight: ${({ $required }) => ($required ? 700 : 500)};
`

export const BooleanText = styled.span`
  color: #059669;
  font-weight: 600;
`

export const EmptyText = styled.div`
  padding: 16px;
  font-size: 14px;
  color: #9ca3af;
`

/** 편집 모드: 기본 정보 2열 그리드 */
export const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

export const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
`

export const FieldLabel = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: #374151;

  .required {
    color: #dc2626;
    margin-left: 2px;
  }
`

export const ChipRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

export const CapabilityChip = styled.button<{ $active?: boolean; $color: string }>`
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid ${({ $active, $color }) => ($active ? $color : '#e5e7eb')};
  background: ${({ $active, $color }) => ($active ? `${$color}1f` : '#f9fafb')};
  color: ${({ $active, $color }) => ($active ? $color : '#6b7280')};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
`

/** 편집 모드: 파라미터 행 */
export const ParamRow = styled.div`
  display: grid;
  /* 핸들 | 이름 | 타입 | 타입 상세(content_type / item_type) | 기본값 | 필수 | 삭제 */
  grid-template-columns: 24px minmax(0, 1.4fr) 150px 150px minmax(0, 1fr) 84px 32px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f9fafb;

  @media (max-width: 900px) {
    grid-template-columns: 24px minmax(0, 1fr) 120px;
    row-gap: 8px;
  }

  /*
    모바일에서는 열이 7개라 어느 입력이 무엇인지 알 수 없다.
    입력을 한 줄에 하나씩 세우고, 드래그 핸들은 숨기고 삭제 버튼만 오른쪽 위에 남긴다.
  */
  @media all and (max-width: 767px) {
    grid-template-columns: minmax(0, 1fr) 32px;
    row-gap: 8px;
    align-items: start;

    /* 드래그 핸들 */
    > *:nth-child(1) {
      display: none;
    }

    /* 이름 · 타입 · 타입 상세 · 기본값 · 필수 */
    > *:nth-child(n + 2):nth-child(-n + 6) {
      grid-column: 1;
    }

    /* 삭제 버튼 */
    > *:last-child {
      grid-column: 2;
      grid-row: 1;
    }
  }
`

export const DragHandle = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  color: #cbd5e1;
  cursor: grab;
`

export const RequiredCheckLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4b5563;
  white-space: nowrap;
  cursor: pointer;
`

export const RowDeleteButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;

  &:hover {
    background: #f3f4f6;
    color: #4b5563;
  }
`

/** 네이티브 select(공통 Dropdown 이 폼 행 안에서 너무 커서 여기서는 select 를 쓴다) */
export const SelectInput = styled.select`
  width: 100%;
  height: 40px;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  font-size: 14px;
  cursor: pointer;
`

export const TextInput = styled.input`
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  font-size: 14px;

  &::placeholder {
    color: #9ca3af;
  }
`

export const PageMessage = styled.div`
  padding: 40px 16px;
  text-align: center;
  font-size: 14px;
  color: #6b7280;
`
