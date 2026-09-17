import styled, { css, keyframes } from 'styled-components'
import { Handle } from '@xyflow/react'

/** =========================
 *  Handle 방향 상수
 *  ========================= */

export const StartH = {
  right: 'right'
} as const

export const TaskH = {
  right: 'right',
  bottom: 'bottom',
  left: 'left'
} as const

/** =========================
 *  공통 Handle 스타일
 *  ========================= */

export const NodeHandle = styled(Handle)`
  width: 8px;
  height: 8px;
  border-radius: 9999px;

  background: #e2e8f0;
  border: 1px solid #cbd5e1;

  z-index: 2;

  /* 연결 시작이 잘 안 되는 문제를 줄이기 위해,
     시각 점보다 넓은 투명 히트 영역을 추가한다. */
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 20px;
    height: 20px;
    transform: translate(-50%, -50%);
    border-radius: 9999px;
    background: transparent;
  }
`

export const LeftHandle = styled(NodeHandle)`
  top: 50%;
`

/** =========================
 *  공통 Node 레이아웃
 *  ========================= */

export const BaseNodeRoot = styled.div<{
  $selected: boolean
}>`
  width: 78px;
  aspect-ratio: 5 / 3;

  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #ffffff;

  padding: 4px 6px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);

  position: relative;
  overflow: visible;

  display: flex;
  align-items: center;
  justify-content: center;

  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;

  transition:
    box-shadow 120ms ease-out,
    transform 120ms ease-out;

  ${({ $selected }) =>
    $selected
      ? css`
          /* 노드 카드에는 실행 상태색이 인라인 borderColor 로 걸려 CSS border-color 가 밀린다.
             그래서 선택 강조는 인라인 스타일과 겹치지 않는 outline + halo 로 표현한다.
             색은 앱 테마의 활성 상태 색(클래식 블루=파랑 / 모던 뉴트럴=taupe)을 따른다. */
          outline: 2px solid var(--t-toggle-active-bg);
          outline-offset: 2px;

          box-shadow:
            0 0 0 6px rgba(var(--t-toggle-active-bg-rgb), 0.2),
            0 8px 18px rgba(15, 23, 42, 0.2);

          transform: translateY(-1px);
        `
      : css`
          border-color: #e2e8f0;
        `}
`

export const BaseBadgeRow = styled.div`
  position: absolute;
  top: 4px;
  left: 6px;

  display: flex;
  gap: 2px;

  max-width: calc(100% - 12px);
  overflow: hidden;
`

export const BaseTitle = styled.div`
  text-align: center;

  font-size: 10px;
  font-weight: 800;
  color: #0f172a;

  width: 100%;
  word-break: break-word;
  overflow-wrap: anywhere;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
`

/** =========================
 *  StartNode 스타일
 *  ========================= */

export const StartNodeRoot = styled(BaseNodeRoot)`
  /* 좌측 컬러 바가 카드 바깥 변에 붙도록 왼쪽 회색 보더 제거 */
  border-left: none;

  /* 좌측 컬러 바 (Control 과 동일한 보라) */
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-top-left-radius: inherit;
    border-bottom-left-radius: inherit;
    background: #8b5cf6;
  }
`

export const StartBadgeRow = styled(BaseBadgeRow)`
  flex-wrap: wrap;
`

export const StartTitle = BaseTitle

const startBadgeBase = css`
  display: inline-flex;
  align-items: center;

  border-radius: 9999px;
  padding: 0 3px;
  line-height: 1;

  font-size: 6px;
  font-weight: 700;
`

export const RootBadge = styled.span`
  ${startBadgeBase};
  border: 1px solid #a7f3d0;
  background: #ecfdf5;
  color: #047857;
`

/** =========================
 *  TaskNode 스타일
 *  ========================= */

// taskType 별 좌측 컬러 바 색상 (Action=파랑 / Control=보라)
const TASK_BAR_COLOR: Record<string, string> = {
  ACTION: '#3b82f6',
  CONTROL: '#8b5cf6',
  ROOT: '#10b981'
}

export const TaskNodeRoot = styled(BaseNodeRoot)<{ $taskType?: string }>`
  /* 좌측 컬러 바가 카드 바깥 변에 붙도록 왼쪽 회색 보더 제거 */
  border-left: none;

  /* 좌측 컬러 바 (taskType 기준) */
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-top-left-radius: inherit;
    border-bottom-left-radius: inherit;
    background: ${({ $taskType }) => TASK_BAR_COLOR[String($taskType ?? '').toUpperCase()] ?? '#3b82f6'};
  }
`

export const TaskBadgeRow = styled(BaseBadgeRow)`
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
`

export const TaskRunningCountBadge = styled(BaseBadgeRow)`
  left: auto;
  top: -5px;
  right: 0px;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
`
const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
  `
export const CircleBadge = styled.div`
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #3b82f6;

  animation: ${blink} 1s ease-in-out infinite;
`

// 상단 배지(Pill)가 있는 노드는 제목을 배지 높이만큼 아래로 내려 겹침을 막는다.
export const TaskTitle = styled(BaseTitle)<{ $hasBadge?: boolean }>`
  padding-top: ${({ $hasBadge }) => ($hasBadge ? '9px' : '0')};
`

const pillBase = css`
  display: inline-flex;
  align-items: center;
  gap: 1px;

  max-width: 100%;
  flex-shrink: 0;

  border-radius: 9999px;
  border: 1px solid #e2e8f0;

  padding: 0 3px;
  line-height: 1;

  font-size: 6px;
  font-weight: 700;
`

export const Pill = styled.span<{ $tone: 'name' }>`
  ${pillBase};
  background: #ffffff;
  color: #475569;
  border-color: #e2e8f0;
`

// Parallel 의 main 노드 표시 배지 (좌하단)
export const MainNodeBadge = styled.span`
  position: absolute;
  bottom: -5px;
  left: 0px;

  display: inline-flex;
  align-items: center;

  border-radius: 9999px;
  border: 1px solid #c7d2fe;
  background: #eef2ff;
  color: #4338ca;

  padding: 0 3px;
  line-height: 1;

  font-size: 6px;
  font-weight: 800;
  letter-spacing: 0.3px;

  z-index: 3;
`

const BRANCH_ROLE_BADGE_STYLE: Record<'CONDITION' | 'SUCCESS' | 'FAILURE', { border: string; bg: string; color: string }> = {
  CONDITION: {
    border: '#c4b5fd',
    bg: '#f5f3ff',
    color: '#6d28d9'
  },
  SUCCESS: {
    border: '#86efac',
    bg: '#ecfdf5',
    color: '#166534'
  },
  FAILURE: {
    border: '#fda4af',
    bg: '#fff1f2',
    color: '#be123c'
  }
}

export const BranchRoleBadge = styled.span<{ $role: 'CONDITION' | 'SUCCESS' | 'FAILURE' }>`
  position: absolute;
  bottom: -5px;
  left: 0px;

  display: inline-flex;
  align-items: center;

  border-radius: 9999px;
  border: 1px solid ${({ $role }) => BRANCH_ROLE_BADGE_STYLE[$role].border};
  background: ${({ $role }) => BRANCH_ROLE_BADGE_STYLE[$role].bg};
  color: ${({ $role }) => BRANCH_ROLE_BADGE_STYLE[$role].color};

  padding: 0 3px;
  line-height: 1;

  font-size: 6px;
  font-weight: 800;
  letter-spacing: 0.3px;

  z-index: 3;
`

export const PillText = styled.span`
  display: block;
  min-width: 0;

  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

// 점검(inspect) breakpoint 표시 점 (좌상단). IDE 의 중단점 마커처럼 빨간 원.
export const BreakpointDot = styled.span`
  position: absolute;
  top: -6px;
  left: -6px;

  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #dc2626;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.35);

  z-index: 4;
`

// "실행 결과 강제"(SUCCESS/FAILURE/RUNNING) 표시. 우상단, breakpoint 점의 절반 크기 네모.
const FORCED_MARK_COLOR: Record<'SUCCESS' | 'FAILURE' | 'RUNNING', string> = {
  SUCCESS: '#34d399',
  FAILURE: '#fb7185',
  RUNNING: '#60a5fa'
}

export const ForcedResultMark = styled.span<{ $result: 'SUCCESS' | 'FAILURE' | 'RUNNING' }>`
  position: absolute;
  top: -3px;
  right: -3px;

  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: ${({ $result }) => FORCED_MARK_COLOR[$result]};
  border: 1px solid #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.35);

  z-index: 4;
`

// 점검 시 현재 RUNNING 노드의 tick 반복 횟수(우하단). 같은 노드에 tick 이 다시 오면 숫자가 증가한다.
export const TickCountBadge = styled.span`
  position: absolute;
  bottom: -6px;
  right: -6px;

  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: #2563eb;
  color: #ffffff;
  border: 1px solid #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.35);

  font-size: 8px;
  font-weight: 800;
  line-height: 12px;
  text-align: center;

  z-index: 4;
`

export type TaskExecStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'SKIPPED'

export const DEFAULT_TASK_STATUS: TaskExecStatus = 'IDLE'

export const TASK_STATUS_ALIASES: Record<string, TaskExecStatus> = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  FAILED: 'FAILURE',
  FAIL: 'FAILURE',
  SKIPPED: 'SKIPPED',
  SKIP: 'SKIPPED'
}

export const execStyle: Record<TaskExecStatus, { border: string; bg: string; text: string; sub: string; handle: string }> = {
  IDLE: {
    border: '#cbd5e1',
    bg: '#ffffff',
    text: '#475569',
    sub: '#94a3b8',
    handle: '#cbd5e1'
  },
  RUNNING: {
    border: '#60a5fa',
    bg: '#eff6ff',
    text: '#1d4ed8',
    sub: '#60a5fa',
    handle: '#60a5fa'
  },
  SUCCESS: {
    border: '#34d399',
    bg: '#ecfdf5',
    text: '#065f46',
    sub: '#10b981',
    handle: '#34d399'
  },
  FAILURE: {
    border: '#fb7185',
    bg: '#fff1f2',
    text: '#be123c',
    sub: '#fb7185',
    handle: '#fb7185'
  },
  SKIPPED: {
    border: '#cbd5e1',
    bg: '#f8fafc',
    text: '#64748b',
    sub: '#94a3b8',
    handle: '#cbd5e1'
  }
}
