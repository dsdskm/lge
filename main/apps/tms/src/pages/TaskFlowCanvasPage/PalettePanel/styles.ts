// PalettePanel.styles.ts
import styled, { css } from 'styled-components'

export { PanelRoot } from '../styles.shared'

export const HeaderRow = styled.div`
  margin-bottom: 12px; /* mb-3 */
  display: flex;
  align-items: center;
  justify-content: space-between;
`

export const Subtitle = styled.div`
  font-size: 12px; /* text-xs */
  font-weight: 600; /* font-semibold */
  color: #64748b; /* slate-500 */
`

export const LoadingText = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
`

export const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px; /* space-y-3 */
`

export const Section = styled.section`
  overflow: hidden;
  border-radius: 12px; /* rounded-xl */
  border: 1px solid #e2e8f0; /* slate-200 */
  background: #ffffff;
`

export const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--t-header-bg);
  padding: 8px 12px; /* px-3 py-2 */
`

export const SectionTitle = styled.div`
  font-size: 14px; /* text-sm */
  font-weight: 800; /* font-extrabold */
  color: #0f172a; /* slate-900 */
`

export const SectionBody = styled.div`
  border-top: 1px solid #f1f5f9; /* slate-100 */
`

export const SectionBodyPadded = styled(SectionBody)`
  padding: 12px; /* p-3 */
`

export const ContentGrid = styled.div<{ $compact: boolean; $narrow: boolean }>`
  display: grid;
  gap: 8px;

  grid-template-columns: ${({ $narrow, $compact }) => {
    if ($narrow) return '1fr'
    if ($compact) return 'repeat(2, minmax(0, 1fr))'
    return 'repeat(3, minmax(0, 1fr))'
  }};

  border-radius: 8px;
  background: #f8fafc; /* slate-50 */
`

export const ControlGrid = styled.div<{ $compact: boolean; $narrow: boolean }>`
  display: grid;
  gap: 8px;

  grid-template-columns: ${({ $narrow, $compact }) => {
    if ($narrow) return '1fr'
    if ($compact) return 'repeat(2, minmax(0, 1fr))'
    return 'repeat(3, minmax(0, 1fr))'
  }};
`

export const DividerList = styled.div`
  border-top: 1px solid #f1f5f9; /* slate-100 */

  > * + * {
    border-top: 1px solid #f1f5f9; /* divide-y slate-100 */
  }
`

/* Task row button */
export const TaskToggleButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 8px 12px; /* px-3 py-2 */
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;

  &:hover {
    background: #f8fafc; /* slate-50 */
  }
`

export const TaskName = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.5;
`

export const MoveToGrouping = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;

  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;

  font-size: 12px;
  line-height: 1.4;
  color: inherit;
  margin-top: 10px;
  margin-bottom: 5px;
`

export const GroupingText = styled.span`
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
`

export const Chevron = styled.span<{ $open: boolean }>`
  display: inline-block;
  color: #64748b; /* slate-500 */
  transition: transform 140ms ease;

  transform: ${({ $open }) => ($open ? 'rotate(90deg)' : 'rotate(0deg)')};
`

/* Content list wrapper when open */
export const ContentBlock = styled.div`
  padding: 0 12px 12px; /* px-3 pb-3 */
`

/* Card base */
const selectedStyles = css`
  border-color: #393b3dff; /* slate-400 */
  background: #f1f5f9; /* slate-100 */
`

const unselectedStyles = css`
  border-color: #e2e8f0; /* slate-200 */
  background: #ffffff;

  &:hover {
    background: #f8fafc; /* slate-50 */
  }
`

export const NodeCard = styled.div<{ $selected: boolean }>`
  width: 100%;
  cursor: pointer;
  user-select: none;

  border-radius: 8px; /* rounded-lg */
  border: 1px solid #e2e8f0;
  padding: 6px; /* p-1.5 */

  font-size: 14px; /* text-sm */
  font-weight: 600; /* font-semibold */
  color: #0f172a;

  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08); /* shadow-sm */

  /* aspect-[5/3] + center */
  aspect-ratio: 5 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;

  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
  overflow: hidden;

  ${({ $selected }) => ($selected ? selectedStyles : unselectedStyles)};
`

export const CardLabel = styled.div`
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;

  overflow: hidden;
  text-overflow: ellipsis;

  font-size: 11px;
  line-height: 1.4;
`

/* Disabled row */
export const DisabledRow = styled.div`
  cursor: not-allowed;
  user-select: none;
  padding: 8px 12px; /* px-3 py-2 */
`

export const DisabledName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  font-size: 14px;
  font-weight: 800;
  color: #334155; /* slate-700 */
`