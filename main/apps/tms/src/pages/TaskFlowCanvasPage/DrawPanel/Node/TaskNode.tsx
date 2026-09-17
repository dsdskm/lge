import type { NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'

import {
  TaskNodeRoot,
  NodeHandle,
  TaskH,
  TaskBadgeRow,
  TaskTitle,
  Pill as StyledPill,
  PillText,
  TaskRunningCountBadge,
  CircleBadge,
  MainNodeBadge,
  BranchRoleBadge,
  BreakpointDot,
  ForcedResultMark,
  TickCountBadge,
  execStyle,
  TASK_STATUS_ALIASES,
  DEFAULT_TASK_STATUS,
  type TaskExecStatus
} from './styles.node'
import { RFTaskNode } from '../types'
import { useFlowEditorStore } from '@/store/taskflow.canvas.store'
import { getHandlePositions } from '@/utils/node.util'

type Props = NodeProps<RFTaskNode>

function normalizeTaskStatus(status?: string | null): TaskExecStatus {
  const normalized = String(status ?? '').trim().toUpperCase()
  if (!normalized) return DEFAULT_TASK_STATUS

  return TASK_STATUS_ALIASES[normalized] ?? DEFAULT_TASK_STATUS
}

export default function TaskNode({ id, data, selected }: Props) {
  const isContentNode = typeof data?.contentId === 'number'

  const title = (data?.label ?? '').trim()
  const taskName = (data?.taskName ?? '').trim()
  const hasBadge = isContentNode && Boolean(taskName)
  const taskStatus = normalizeTaskStatus(data?.taskStatus)
  const taskStyle = execStyle[taskStatus]

  // 핸들 ID 는 그대로 두고, 모드에 따라 시각적 위치만 바꾼다 (BT 생성은 동일)
  //  - 가로(default): 입력/분기출력=왼쪽, 주흐름 출력=오른쪽
  //  - 세로(tree)   : 입력/분기출력=위,   주흐름 출력=아래
  const flowMode = useFlowEditorStore((s) => s.flowMode)
  const pos = getHandlePositions(flowMode)

  // Parallel 노드의 MAIN 표시는 명시적으로 선택된 경우에만 한다.
  // 자식 노드를 붙이는 순간 자동으로 MAIN으로 바꾸지 않도록 한다.
  const isMainNode = useFlowEditorStore((s) => {
    const parentEdge = s.edges.find(
      (e) => String(e.target) === String(id) && (e.sourceHandle ?? '') === 'left'
    )
    if (!parentEdge) return false

    const parent = s.nodes.find((n) => String(n.id) === String(parentEdge.source))
    if (!parent) return false

    const pData: any = parent.data ?? {}
    const isParallel =
      String(pData.taskType ?? '').toUpperCase() === 'CONTROL' &&
      String(pData.taskName ?? pData.label ?? pData.name ?? '')
        .trim()
        .toLowerCase() === 'parallel'
    if (!isParallel) return false

    const main = pData?.properties?.main_nodes
    return Array.isArray(main) && main.map((v: any) => String(v)).includes(String(id))
  })

  const branchRole = useFlowEditorStore((s) => {
    const parentEdge = s.edges.find(
      (e) => String(e.target) === String(id) && (e.sourceHandle ?? '') === 'left'
    )
    if (!parentEdge) return null

    const parent = s.nodes.find((n) => String(n.id) === String(parentEdge.source))
    if (!parent) return null

    const parentData: any = parent.data ?? {}
    const parentName = String(parentData.taskName ?? parentData.label ?? parentData.name ?? '')
      .trim()
      .toLowerCase()
    const parentType = String(parentData.taskType ?? '').toUpperCase()
    if (parentType !== 'CONTROL' || !['ifthenelse', 'if then else', 'if_then_else'].includes(parentName)) {
      return null
    }

    const raw = parentData?.properties?.ifthenelse_branch_roles ?? {}
    const role = String(raw[String(id)] ?? '').trim().toLowerCase()
    if (role === 'condition' || role === 'success' || role === 'failure') {
      return role.toUpperCase() as 'CONDITION' | 'SUCCESS' | 'FAILURE'
    }

    return null
  })

  return (
    <TaskNodeRoot
      $selected={selected}
      $taskType={data?.taskType}
      style={{
        background: taskStyle.bg,
        borderColor: taskStyle.border
      }}
    >
      {/* 주 흐름(true/next) 출력: 가로=오른쪽, 세로=아래 */}
      <NodeHandle type="source" position={pos.right} id={TaskH.right} isConnectableStart isConnectableEnd />

      {/* 단일 left 핸들이 입력 + 분기 출력을 겸한다: 가로=왼쪽, 세로=위 */}
      <NodeHandle type="source" position={pos.left} id={TaskH.left} isConnectableStart isConnectableEnd />

      <TaskBadgeRow>{hasBadge ? <Pill tone="name">{taskName}</Pill> : null}</TaskBadgeRow>
      <TaskRunningCountBadge>
        {(data?.runningCount ?? -1) > 0 ? (
          <Pill tone="name" dot={data.taskStatus === 'RUNNING'}>
            {data?.runningCount}
          </Pill>
        ) : null}
      </TaskRunningCountBadge>

      <TaskTitle
        $hasBadge={hasBadge}
        style={{ color: taskStyle.text, fontSize: fitTitleFontSize(title.length, hasBadge), lineHeight: 1.15 }}
      >
        {title}
      </TaskTitle>

      {isMainNode && <MainNodeBadge>MAIN</MainNodeBadge>}
      {branchRole && <BranchRoleBadge $role={branchRole}>{branchRole}</BranchRoleBadge>}

      {data?.breakpoint && <BreakpointDot />}
      {data?.forcedResult && <ForcedResultMark $result={data.forcedResult} />}
      {(data?.tickCount ?? 0) > 0 && <TickCountBadge>{data.tickCount}</TickCountBadge>}
    </TaskNodeRoot>
  )
}

// 노드 폭(78px)·3줄 클램프 기준으로, 이름이 길수록 폰트를 줄여 안 잘리게 맞춘다.
// 상단 배지가 있으면 제목이 쓸 수 있는 높이가 줄어드는 만큼 한 단계 더 작게 잡는다.
function fitTitleFontSize(len: number, hasBadge: boolean): number {
  if (len <= 12) return 10
  if (len <= 22) return hasBadge ? 9 : 10
  if (len <= 30) return hasBadge ? 8 : 9
  if (len <= 46) return hasBadge ? 7 : 8
  return 6
}

function Pill({ children, tone, dot = false }: { children: ReactNode; tone: 'name'; dot?: boolean }) {
  const title = typeof children === 'string' ? children : undefined

  return (
    <StyledPill $tone={tone}>
      <PillText title={title}>{children}</PillText>
      {dot && <CircleBadge />}
    </StyledPill>
  )
}
