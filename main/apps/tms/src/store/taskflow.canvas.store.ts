import { create } from 'zustand'
import type { Node, Edge, XYPosition, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import {
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  addEdge,
  reconnectEdge as reconnectEdgeHelper
} from '@xyflow/react'

import type { TaskApiPayload, ContentApiPayload, PropertySchema } from '../types/api/taskPayload'

import type { Task } from '../types/task'
import { listTasks } from '../api/taskApi'
import { resolveIfThenElseBranchRoles } from '../utils/ifThenElseRoles'
import type { PaletteItem } from '../types/palette'
import {
  TASK_TYPE_CONTROL,
  TASK_TYPE_ROOT,
  EXECUTION_CONDITION_KEY,
  EXECUTION_CONDITION_DEFAULT
} from '../common/constants'
import { ensureStartNode, isStartNodeId, START_NODE_ID } from '../utils/node.util'
import type { FlowMode } from '../utils/node.util'
import { fetchUpdatedContents } from '../utils/fetchAvailableContents'
import {
  getContentIdsInNodes,
  refreshContentNodes,
  type ContentChange,
  type MissingContent
} from '../utils/refreshTaskflowContents'
import { getHelperLines } from '../utils/helperLines'
import { getConnectDenyReason, type ConnectDenyReason } from '../utils/taskflowConnectRules'

export type NodeData = {
  label?: string

  taskId?: number
  taskName?: string
  taskType?: string

  contentId?: number
  contentName?: string
  contentTypeId?: number
  contentTypeName?: string
  contentValue?: string
  contentVersion?: string
  groupId?: string | null
  siteId?: string | null

  propertySchema?: PropertySchema
  properties?: Record<string, any>
}

export type RFNode = Node<NodeData>

// 엣지 시각 유형 (곡선/직선/꺾은선) — 의미(sourceHandle)와 무관한 표시 스타일
export type EdgeVisualType = 'bezier' | 'straight' | 'step'
export const DEFAULT_EDGE_TYPE: EdgeVisualType = 'bezier'

export type EdgeWaypoint = { x: number; y: number }

export type RFEdge = Edge<{
  sourceNodeId?: string | null
  targetNodeId?: string | null
  sourceHandleId?: string | null
  targetHandleId?: string | null
  edgeType?: EdgeVisualType
  // 사용자가 드래그로 추가/이동한 경유점(플로우 좌표). 연결(source/target)은 유지한 채 경로만 구부린다.
  waypoints?: EdgeWaypoint[]
}>

export type RFViewport = {
  x: number
  y: number
  zoom: number
}

export type CanvasNote = {
  id: string
  x: number
  y: number
  title: string
  text: string
  width: number
  height: number
  color: string
}

type FlowSnapshot = {
  nodes: RFNode[]
  edges: RFEdge[]
  viewport: RFViewport
  flowMode: FlowMode
}

const HISTORY_LIMIT = 80
const DEFAULT_VIEWPORT: RFViewport = { x: 0, y: 0, zoom: 1 }

const DEFAULT_FLOW_MODE: FlowMode = 'default'

function normalizeFlowMode(value: any): FlowMode {
  return 'default'
}

function cloneSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  if (typeof structuredClone === 'function') return structuredClone(snapshot)
  return JSON.parse(JSON.stringify(snapshot)) as FlowSnapshot
}

/**
 * 이미 쓰인 id 를 피해서 다음 id 를 발급한다.
 * 저장된 flow 의 id 가 (기기 간 시계 오차 등으로) 미래 값일 수 있으므로 그 뒤로 건너뛴다.
 * 한 번 건너뛸 때마다 값이 반드시 증가하므로 반복 횟수는 기존 id 개수를 넘지 않는다.
 */
function nextUniqueId(used: Set<string>): string {
  let candidate = generateNodeId()

  while (used.has(candidate)) {
    lastIssuedId = Number(candidate) + 1
    candidate = String(lastIssuedId)
  }

  used.add(candidate)
  return candidate
}

function cloneNodeData(data?: NodeData): NodeData {
  if (!data) return {}
  if (typeof structuredClone === 'function') return structuredClone(data)
  return JSON.parse(JSON.stringify(data)) as NodeData
}

/**
 * 삭제/복제 대상 노드 id 목록.
 * - 박스 드래그·ctrl 클릭으로 만든 그룹 선택(node.selected)과 단일 선택(selectedNodeId)을 함께 본다.
 * - START 노드는 삭제/복제 대상에서 제외한다.
 */
export function getEditableSelectedNodeIds(nodes: RFNode[], selectedNodeId: string | null): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    const id = String(node.id)
    if (!node.selected || isStartNodeId(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  if (selectedNodeId && !isStartNodeId(selectedNodeId) && !seen.has(selectedNodeId)) {
    if (nodes.some((node) => String(node.id) === selectedNodeId)) ids.push(selectedNodeId)
  }

  return ids
}

export function countEditableSelectedNodes(state: { nodes: RFNode[]; selectedNodeId: string | null }): number {
  return getEditableSelectedNodeIds(state.nodes, state.selectedNodeId).length
}

// 노드 실측 크기가 없을 때 쓰는 기본 크기 (styles.node.ts 의 78px / aspect 5:3 기준)
const NODE_FALLBACK_WIDTH = 78
const NODE_FALLBACK_HEIGHT = 47
// 복제본을 원본 그룹에서 떼어놓을 간격
const DUPLICATE_GAP = 40

type NodeBox = { left: number; top: number; right: number; bottom: number }

function getNodeBox(node: RFNode, offset: XYPosition = { x: 0, y: 0 }): NodeBox {
  const measured = (node as any)?.measured
  const width = Number(measured?.width) > 0 ? Number(measured.width) : NODE_FALLBACK_WIDTH
  const height = Number(measured?.height) > 0 ? Number(measured.height) : NODE_FALLBACK_HEIGHT
  const left = Number(node.position?.x ?? 0) + offset.x
  const top = Number(node.position?.y ?? 0) + offset.y

  return { left, top, right: left + width, bottom: top + height }
}

function boxesOverlap(a: NodeBox, b: NodeBox): boolean {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
}

/**
 * 복제본을 놓을 위치 오프셋.
 * 원본 그룹 옆(가로 모드) / 아래(세로 모드)로 그룹 전체를 통째로 비켜 놓고,
 * 기존 노드와 겹치면 같은 방향으로 한 칸 더 밀어 빈 자리를 찾는다.
 */
function computeDuplicateOffset(targets: RFNode[], allNodes: RFNode[], flowMode: FlowMode): XYPosition {
  const boxes = targets.map((node) => getNodeBox(node))
  const groupWidth = Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left))
  const groupHeight = Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top))

  const step: XYPosition =
    flowMode === 'tree' ? { x: 0, y: groupHeight + DUPLICATE_GAP } : { x: groupWidth + DUPLICATE_GAP, y: 0 }

  const occupied = allNodes.map((node) => getNodeBox(node))

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const offset = { x: step.x * attempt, y: step.y * attempt }
    const collides = targets.some((node) => {
      const box = getNodeBox(node, offset)
      return occupied.some((other) => boxesOverlap(box, other))
    })

    if (!collides) return offset
  }

  // 빈 자리를 못 찾으면 대각선으로 살짝 어긋나게 놓아 최소한 겹쳐 보이지 않게 한다.
  return { x: step.x + DUPLICATE_GAP, y: step.y + DUPLICATE_GAP }
}

function makeSnapshot(nodes: RFNode[], edges: RFEdge[], viewport: RFViewport, flowMode: FlowMode): FlowSnapshot {
  return cloneSnapshot({ nodes, edges, viewport, flowMode })
}

function normalizeTaskName(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function pushHistory(historyPast: FlowSnapshot[], prev: FlowSnapshot) {
  const nextPast = [...historyPast, prev].slice(-HISTORY_LIMIT)

  return {
    historyPast: nextPast,
    historyFuture: [] as FlowSnapshot[],
    canUndo: nextPast.length > 0,
    canRedo: false,
    // 히스토리를 남기는 변경 = 저장이 필요한 변경. (선택/측정/패닝은 여기로 오지 않는다)
    isDirty: true
  }
}

function adjustParallelCountsForRemovedChildren(nodes: RFNode[], removedEdges: RFEdge[]): RFNode[] {
  if (removedEdges.length === 0) return nodes

  const removedCountByParallel = new Map<string, number>()

  for (const edge of removedEdges) {
    if (String(edge.sourceHandle ?? '') !== 'left') continue

    const sourceId = String(edge.source)
    const targetId = String(edge.target)
    if (!sourceId || !targetId) continue

    const current = removedCountByParallel.get(sourceId) ?? 0
    removedCountByParallel.set(sourceId, current + 1)
  }

  if (removedCountByParallel.size === 0) return nodes

  return nodes.map((node) => {
    const parallelId = String(node.id)
    const removedCount = removedCountByParallel.get(parallelId)
    if (!removedCount) return node

    const properties = { ...(node.data?.properties ?? {}) }
    let changed = false

    for (const key of ['success_count', 'failure_count'] as const) {
      const currentValue = properties[key]
      if (currentValue === -1 || currentValue === '-1') continue

      const numericValue = Number(currentValue)
      if (!Number.isFinite(numericValue)) continue

      properties[key] = Math.max(0, numericValue - removedCount)
      changed = true
    }

    if (!changed) return node

    return {
      ...node,
      data: {
        ...(node.data ?? {}),
        properties
      }
    }
  })
}

// 노드/엣지 id 는 타임스탬프 문자열을 쓴다.
// 같은 밀리초에 여러 개를 만들면(복제 등) 값이 겹치므로 마지막 발급값을 기억해 항상 증가시킨다.
let lastIssuedId = 0

function generateNodeId(): string {
  const now = Date.now()
  lastIssuedId = now > lastIssuedId ? now : lastIssuedId + 1

  return String(lastIssuedId)
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function toStringOrEmpty(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function normalizeViewport(viewport: any): RFViewport {
  if (Array.isArray(viewport)) {
    return {
      x: Number(viewport[0] ?? DEFAULT_VIEWPORT.x),
      y: Number(viewport[1] ?? DEFAULT_VIEWPORT.y),
      zoom: Number(viewport[2] ?? DEFAULT_VIEWPORT.zoom)
    }
  }

  if (viewport && typeof viewport === 'object') {
    return {
      x: Number(viewport.x ?? DEFAULT_VIEWPORT.x),
      y: Number(viewport.y ?? DEFAULT_VIEWPORT.y),
      zoom: Number(viewport.zoom ?? DEFAULT_VIEWPORT.zoom)
    }
  }

  return { ...DEFAULT_VIEWPORT }
}

const DEFAULT_CANVAS_NOTE_WIDTH = 240
const DEFAULT_CANVAS_NOTE_HEIGHT = 150
const DEFAULT_CANVAS_NOTE_COLOR = '#fef3c7'
const DEFAULT_CANVAS_NOTE_TITLE = '메모'

function normalizeCanvasNote(note: any): CanvasNote {
  return {
    id: String(note?.id ?? generateNodeId()),
    x: Number(note?.x ?? 0),
    y: Number(note?.y ?? 0),
    title: String(note?.title ?? DEFAULT_CANVAS_NOTE_TITLE),
    text: String(note?.text ?? ''),
    width: Number(note?.width ?? DEFAULT_CANVAS_NOTE_WIDTH),
    height: Number(note?.height ?? DEFAULT_CANVAS_NOTE_HEIGHT),
    color: String(note?.color ?? DEFAULT_CANVAS_NOTE_COLOR)
  }
}

function createCanvasNote(position: XYPosition): CanvasNote {
  return {
    id: generateNodeId(),
    x: Math.round(Number(position?.x ?? 0)),
    y: Math.round(Number(position?.y ?? 0)),
    title: DEFAULT_CANVAS_NOTE_TITLE,
    text: '',
    width: DEFAULT_CANVAS_NOTE_WIDTH,
    height: DEFAULT_CANVAS_NOTE_HEIGHT,
    color: DEFAULT_CANVAS_NOTE_COLOR
  }
}

function normalizeContentPayload(content: any): ContentApiPayload {
  return {
    contentTypeId: Number(content?.contentTypeId ?? 0),
    contentTypeName: toStringOrEmpty(content?.contentTypeName),
    contentValue: toStringOrEmpty(content?.contentValue),
    contentVersion: toStringOrEmpty(content?.contentVersion),
    createdAt: toStringOrEmpty(content?.createdAt),
    groupId: toStringOrNull(content?.groupId),
    id: Number(content?.id ?? 0),
    name: toStringOrEmpty(content?.name),
    siteId: toStringOrNull(content?.siteId),
    status: toStringOrEmpty(content?.status),
    updatedAt: toStringOrEmpty(content?.updatedAt),
    version: toStringOrEmpty(content?.version)
  }
}

function normalizeTaskPayload(task: Task): TaskApiPayload {
  const raw = task as any
  const rawContents = Array.isArray(raw?.contents) ? raw.contents : []

  return {
    id: Number(raw?.id ?? 0),
    groupId: toStringOrNull(raw?.groupId),
    siteId: toStringOrNull(raw?.siteId),
    taskType: toStringOrEmpty(raw?.taskType),
    name: toStringOrEmpty(raw?.name),
    propertySchema: raw?.propertySchema,
    minExecVer: toStringOrEmpty(raw?.minExecVer),
    version: toStringOrEmpty(raw?.version),
    description: raw?.description ?? null,
    isDeployable: Boolean(raw?.isDeployable),
    status: toStringOrEmpty(raw?.status),
    createdAt: toStringOrEmpty(raw?.createdAt),
    updatedAt: toStringOrEmpty(raw?.updatedAt),
    contents: rawContents.map(normalizeContentPayload)
  }
}

function buildDefaultProperties(task: TaskApiPayload, content?: ContentApiPayload) {
  const propsDef = task.propertySchema?.properties ?? {}
  const result: Record<string, any> = {}

  for (const [key, def] of Object.entries(propsDef)) {
    if (def?.default !== undefined) {
      result[key] = def.default
    } else if (key === EXECUTION_CONDITION_KEY) {
      // execution_condition 은 메뉴(Boot/Manual) 선택값이며 기본은 Boot
      result[key] = EXECUTION_CONDITION_DEFAULT
    } else {
      result[key] = def?.type === 'boolean' ? false : ''
    }
  }

  if (!content) return result

  for (const [key, def] of Object.entries(propsDef)) {
    if (def?.type === 'content_reference') {
      const want = def.content_type
      const got = content.contentTypeName

      if (!want || !got || want === got) {
        result[key] = content.id
      }
    }
  }

  return result
}

function buildNodeDataFromPaletteItem(item: PaletteItem): NodeData {
  const task = item.task

  if (item.kind === 'contentNode') {
    const content = item.content

    return {
      label: content.name,
      taskId: task.id,
      taskName: task.name,
      taskType: task.taskType,
      contentId: content.id,
      contentName: content.name,
      contentTypeId: content.contentTypeId,
      contentTypeName: content.contentTypeName,
      contentValue: content.contentValue,
      contentVersion: content.version,
      groupId: content.groupId,
      siteId: content.siteId,
      propertySchema: task.propertySchema,
      properties: buildDefaultProperties(task, content)
    }
  }

  return {
    label: task.name,
    taskId: task.id,
    taskName: task.name,
    taskType: task.taskType,
    propertySchema: task.propertySchema,
    properties: buildDefaultProperties(task)
  }
}

function buildPaletteAndCatalog(tasks: TaskApiPayload[]) {
  const palette: PaletteItem[] = []
  const contentsList: ContentApiPayload[] = []

  for (const task of tasks) {
    if (task.taskType === TASK_TYPE_CONTROL) {
      palette.push({ kind: 'controlTaskNode', task, label: task.name })
      continue
    }

    const contents = task.contents ?? []

    // Pause/Wait/Rotate 처럼 콘텐츠를 참조하지 않는 ACTION 은 태스크 자체가 하나의 노드다.
    // 팔레트 패널도 이런 task 를 카드 하나로 보여 준다(ControlTaskNodeCard).
    // 여기서 빠지면 AI 가 "pause 추가해줘" 를 매칭할 대상이 없어 요청을 버린다.
    const referencesContent = Object.values(task.propertySchema?.properties ?? {}).some(
      (property) => property?.type === 'content_reference'
    )
    if (!referencesContent) {
      palette.push({ kind: 'controlTaskNode', task, label: task.name })
      continue
    }

    for (const content of contents) {
      palette.push({
        kind: 'contentNode',
        task,
        content,
        label: content.name
      })
      contentsList.push(content)
    }
  }

  const dedupedCatalog = Array.from(new Map(contentsList.map((content) => [content.id, content])).values())

  return { palette, contentsList: dedupedCatalog }
}

// 캔버스의 start 노드는 코드로 자리만 만들고, 실제 표시 이름/속성 스키마는
// 서버 TaskList 의 ROOT 타입 task 에서 가져온다. (CONTROL 노드와 동일하게 property_schema 로 표현)
// tasks 로드 전에 캔버스가 초기화될 수 있으므로, tasks 가 들어온 시점에도 다시 적용한다.
function applyRootTaskToStartNode(nodes: RFNode[], tasks: TaskApiPayload[]): RFNode[] {
  const rootTask = tasks.find((task) => task.taskType === TASK_TYPE_ROOT)
  if (!rootTask) return nodes

  let changed = false
  const next = nodes.map((node) => {
    if (!isStartNodeId(node.id)) return node

    changed = true
    const existingProps = (node.data?.properties ?? {}) as Record<string, any>

    return {
      ...node,
      data: {
        ...node.data,
        label: rootTask.name,
        taskId: rootTask.id,
        taskName: rootTask.name,
        taskType: rootTask.taskType,
        propertySchema: rootTask.propertySchema,
        // 스키마 기본값 위에 기존 사용자 입력값을 덮어 보존한다.
        properties: { ...buildDefaultProperties(rootTask), ...existingProps }
      }
    }
  })

  return changed ? next : nodes
}

// 연결 거부 사유는 taskflowConnectRules 에서 중앙 관리한다.

// ──────────────────────────────────────────────────────────────
// 노드 정렬(행/열 격자 정돈) 헬퍼
// ──────────────────────────────────────────────────────────────

const ALIGN_DEFAULT_WIDTH = 200
const ALIGN_DEFAULT_HEIGHT = 80
const ALIGN_GAP_X = 80 // 열 간격
const ALIGN_GAP_Y = 60 // 행 간격

function getNodeWidth(node: RFNode): number {
  return Number((node as any).measured?.width ?? (node as any).width ?? 0) || ALIGN_DEFAULT_WIDTH
}

function getNodeHeight(node: RFNode): number {
  return Number((node as any).measured?.height ?? (node as any).height ?? 0) || ALIGN_DEFAULT_HEIGHT
}

// ──────────────────────────────────────────────────────────────
// 모드 전환 시 자동 레이아웃 (레벨/계층 배치)
//   - vertical(tree): 위→아래로 레벨을 쌓고 같은 레벨은 가로로 나열
//   - horizontal(default): 좌→우로 레벨을 쌓고 같은 레벨은 세로로 나열
//   레벨(깊이)은 START(또는 indegree 0) 노드에서의 longest-path 로 계산한다.
// ──────────────────────────────────────────────────────────────

const TREE_GAP_MAIN = 70 // 레벨 간 간격(흐름 방향)
const TREE_GAP_CROSS = 50 // 같은 레벨 노드 간 간격(교차 방향)

function computeLayeredPositions(
  nodes: RFNode[],
  edges: RFEdge[],
  orientation: 'vertical' | 'horizontal'
): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>()
  if (nodes.length === 0) return positions

  const ids = new Set(nodes.map((n) => n.id))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of nodes) {
    children.set(n.id, [])
    indeg.set(n.id, 0)
  }
  for (const e of edges) {
    if (!ids.has(String(e.source)) || !ids.has(String(e.target))) continue
    children.get(String(e.source))!.push(String(e.target))
    indeg.set(String(e.target), (indeg.get(String(e.target)) ?? 0) + 1)
  }

  // 깊이(레벨): 위상정렬 기반 longest path
  const depth = new Map<string, number>()
  const remaining = new Map(indeg)
  const queue: string[] = []
  for (const n of nodes) {
    if ((remaining.get(n.id) ?? 0) === 0) {
      depth.set(n.id, 0)
      queue.push(n.id)
    }
  }
  let qi = 0
  while (qi < queue.length) {
    const u = queue[qi++]
    const du = depth.get(u) ?? 0
    for (const v of children.get(u) ?? []) {
      depth.set(v, Math.max(depth.get(v) ?? 0, du + 1))
      const nd = (remaining.get(v) ?? 0) - 1
      remaining.set(v, nd)
      if (nd === 0) queue.push(v)
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0)

  // 레벨 내 순서: START → indegree 0 순으로 DFS preorder
  const order = new Map<string, number>()
  const visited = new Set<string>()
  let counter = 0
  const dfs = (u: string) => {
    if (visited.has(u)) return
    visited.add(u)
    order.set(u, counter++)
    for (const v of children.get(u) ?? []) dfs(v)
  }
  const roots = [
    START_NODE_ID,
    ...nodes.map((n) => n.id).filter((id) => id !== START_NODE_ID && (indeg.get(id) ?? 0) === 0)
  ].filter((id) => ids.has(id))
  for (const r of roots) dfs(r)
  for (const n of nodes) if (!visited.has(n.id)) dfs(n.id)

  // 레벨별 그룹 + 정렬
  const layers = new Map<number, string[]>()
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d)!.push(n.id)
  }
  for (const arr of layers.values()) {
    arr.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  }

  // 각 레벨의 흐름축 시작 좌표(레벨 간 간격은 직전 레벨의 최대 크기 기준)
  const sortedDepths = [...layers.keys()].sort((a, b) => a - b)
  const mainAxisStart = new Map<number, number>()
  let mainCursor = 0
  for (const d of sortedDepths) {
    mainAxisStart.set(d, mainCursor)
    const layerNodes = layers.get(d)!
    const layerMainSize = Math.max(
      ...layerNodes.map((id) =>
        orientation === 'vertical' ? getNodeHeight(nodeById.get(id)!) : getNodeWidth(nodeById.get(id)!)
      )
    )
    mainCursor += layerMainSize + TREE_GAP_MAIN
  }

  // 좌표 배정 (교차축은 레벨 내에서 누적 배치)
  for (const d of sortedDepths) {
    const layerNodes = layers.get(d)!
    let crossCursor = 0
    for (const id of layerNodes) {
      const node = nodeById.get(id)!
      const w = getNodeWidth(node)
      const h = getNodeHeight(node)
      const main = mainAxisStart.get(d) ?? 0
      if (orientation === 'vertical') {
        positions.set(id, { x: Math.round(crossCursor), y: Math.round(main) })
        crossCursor += w + TREE_GAP_CROSS
      } else {
        positions.set(id, { x: Math.round(main), y: Math.round(crossCursor) })
        crossCursor += h + TREE_GAP_CROSS
      }
    }
  }

  return positions
}

// 가로 레이아웃 좌표를 시계방향 90° 회전해 세로 레이아웃 좌표를 만든다.
//   - 노드 중심을 CW 90° 회전: (cx, cy) → (-cy, cx)  (화면 좌표계 기준 시각적 시계방향)
//   - 회전 후 좌상단 기준으로 되돌리고, 전체를 양수 영역으로 정규화한다.
//   이렇게 하면 "오른쪽으로 나가던 주흐름 → 아래", "왼쪽으로 나가던 분기 → 위"가
//   자식 배치까지 포함해 그대로 회전된 형태가 된다.
function rotatePositionsCW(nodes: RFNode[], positions: Map<string, XYPosition>): Map<string, XYPosition> {
  const rotated = new Map<string, XYPosition>()

  const tmp: { id: string; x: number; y: number }[] = []
  let minX = Infinity
  let minY = Infinity

  for (const node of nodes) {
    const p = positions.get(node.id)
    if (!p) continue
    const w = getNodeWidth(node)
    const h = getNodeHeight(node)
    const cx = p.x + w / 2
    const cy = p.y + h / 2
    // CW 90°: (cx, cy) → (-cy, cx)
    const rx = -cy
    const ry = cx
    // 회전 후에도 노드는 세워진 채이므로 좌상단은 회전된 중심에서 원래 w,h 로 되돌린다
    const x = rx - w / 2
    const y = ry - h / 2
    tmp.push({ id: node.id, x, y })
    if (x < minX) minX = x
    if (y < minY) minY = y
  }

  for (const t of tmp) {
    rotated.set(t.id, { x: Math.round(t.x - minX), y: Math.round(t.y - minY) })
  }

  return rotated
}

// 중심값을 정렬한 뒤, 그룹 시작점(anchor) 기준 임계값을 넘으면 새 그룹으로 분리한다.
// (인접 비교만 하면 대각선 배치가 한 그룹으로 길게 이어지므로 anchor 기준으로 묶는다)
function clusterNodesByCenter(
  nodes: RFNode[],
  getCenter: (n: RFNode) => number,
  threshold: number
): Map<string, number> {
  const sorted = [...nodes].sort((a, b) => getCenter(a) - getCenter(b))
  const indexById = new Map<string, number>()

  let group = 0
  let anchor: number | null = null

  for (const node of sorted) {
    const center = getCenter(node)
    if (anchor === null) anchor = center
    else if (center - anchor > threshold) {
      group += 1
      anchor = center
    }
    indexById.set(node.id, group)
  }

  return indexById
}

// 기준 노드 기준으로 한 축만 맞추는 정렬.
// - 가로 정렬: 가장 왼쪽 노드를 기준으로 Y 좌표만 맞춘다. (상하 이동만)
// - 세로 정렬: 가장 위쪽 노드를 기준으로 X 좌표만 맞춘다. (좌우 이동만)
// 기준 노드는 그대로 고정하고 나머지 노드만 기준선에 맞춰 이동한다.
function computeAlignedGridPositions(
  selectedNodes: RFNode[],
  direction: 'horizontal' | 'vertical' = 'horizontal'
): Map<string, XYPosition> {
  if (selectedNodes.length === 0) return new Map()

  const anchor = [...selectedNodes].sort((a, b) => {
    if (direction === 'horizontal') {
      return Number(a.position?.x ?? 0) - Number(b.position?.x ?? 0)
    }
    return Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)
  })[0]

  const anchorX = Number(anchor.position?.x ?? 0)
  const anchorY = Number(anchor.position?.y ?? 0)

  const positionById = new Map<string, XYPosition>()
  positionById.set(anchor.id, { x: anchorX, y: anchorY })

  for (const node of selectedNodes) {
    if (node.id === anchor.id) continue

    const currentX = Number(node.position?.x ?? 0)
    const currentY = Number(node.position?.y ?? 0)

    if (direction === 'horizontal') {
      positionById.set(node.id, {
        x: currentX,
        y: anchorY
      })
      continue
    }

    positionById.set(node.id, {
      x: anchorX,
      y: currentY
    })
  }

  return positionById
}

// ──────────────────────────────────────────────────────────────
// Store 상태/액션 타입
// ──────────────────────────────────────────────────────────────

type FlowEditorState = {
  loadingTasks: boolean
  tasks: TaskApiPayload[]
  palette: PaletteItem[]
  contentsList: ContentApiPayload[]

  // 현재 편집 중인 taskflow 의 조직 정보(콘텐츠 갱신 시 최신 목록 조회에 사용). loadTasks 에서 세팅.
  groupId: string | null
  siteId: string | null

  nodes: RFNode[]
  edges: RFEdge[]
  canvasNotes: CanvasNote[]
  viewport: RFViewport

  historyPast: FlowSnapshot[]
  historyFuture: FlowSnapshot[]
  canUndo: boolean
  canRedo: boolean

  // 마지막 저장/불러오기 이후 편집이 있었는지. 캔버스를 벗어날 때 경고할지 판단하는 데 쓴다.
  isDirty: boolean
  // 저장 성공 직후 호출해 "저장되지 않은 변경 없음" 상태로 되돌린다.
  markSaved: () => void

  // 현재 편집 중인 flow 의 식별자 ('new' | flowId). 메모리 전용.
  flowKey: string | null

  // 캔버스 표시 방향 모드 (default: 좌→우, tree: 위→아래)
  flowMode: FlowMode
  // 모드별 노드 위치 기억 (토글 시 매번 재배치돼 배치가 날아가지 않도록).
  // 해당 모드 첫 진입에만 자동 레이아웃하고, 이후엔 저장된 위치를 복원한다. (세션 한정, 미영속)
  positionsByMode: Partial<Record<FlowMode, Record<string, XYPosition>>>

  // 드래그 중 정렬 보조선 좌표 (flow 좌표, 드래그 끝나면 undefined). 미영속.
  helperLineVertical?: number
  helperLineHorizontal?: number

  selectedNodeId: string | null
  selectedEdgeId: string | null
  selectedPalette: NodeData | null

  loadTasks: (groupId: string | null, siteId: string | null) => Promise<void>

  // 현재 조직(groupId/siteId)의 최신 콘텐츠로 캔버스 노드의 content* 필드를 갱신한다.
  // 버전이 바뀐 것만 갱신(changed), 최신 목록에 없는 건 갱신 못함(missing)으로 보고한다.
  refreshContents: () => Promise<{ changed: ContentChange[]; missing: MissingContent[] }>

  addNodeFromPalette: (item: Extract<PaletteItem, { kind: 'contentNode' }>, position: XYPosition) => void

  addControlNodeFromTask: (task: TaskApiPayload, position: XYPosition) => void
  addCanvasNote: (position: XYPosition) => void
  updateCanvasNote: (id: string, patch: Partial<CanvasNote>) => void
  removeCanvasNote: (id: string) => void

  selectNode: (id: string | null) => void
  selectEdge: (id: string | null) => void
  selectPalette: (item: PaletteItem | null) => void

  // Ctrl(⌘) + 클릭으로 그룹 선택에서 노드/엣지 추가·제외한다.
  addNodeToSelection: (id: string) => void
  addEdgeToSelection: (id: string) => void
  removeNodeFromSelection: (id: string) => void
  removeEdgeFromSelection: (id: string) => void

  updateSelectedNodeProps: (patch: Record<string, any>) => void

  setNodes: (nodes: RFNode[]) => void
  setEdges: (edges: RFEdge[]) => void
  setCanvasNotes: (notes: CanvasNote[]) => void
  setViewport: (viewport: RFViewport) => void

  applyNodesChange: (changes: NodeChange<RFNode>[]) => void
  applyEdgesChange: (changes: EdgeChange<RFEdge>[]) => void

  connectEdge: (connection: Connection) => ConnectDenyReason | null
  // 엣지 끝점을 다른 핸들로 끌어 재연결(연결 규칙 검증 후 적용). 거부 사유 반환(null=성공)
  reconnectEdge: (oldEdge: RFEdge, newConnection: Connection) => ConnectDenyReason | null
  // 경유점(waypoint) 라이브 업데이트 (드래그 중. 히스토리는 남기지 않음)
  setEdgeWaypoints: (edgeId: string, waypoints: EdgeWaypoint[]) => void
  // 정렬 보조선 좌표 직접 설정 (경유점 드래그 등에서 사용. undefined 로 끄기). 히스토리 미기록.
  setHelperLines: (vertical?: number, horizontal?: number) => void
  // 드래그 시작 시 현재 상태를 한 번 히스토리에 기록 (undo 1스텝용)
  pushHistoryCheckpoint: () => void
  getSelectedNode: () => RFNode | null
  loadFromFlowDefinition: (def: Record<string, unknown>) => void
  // 외부에서 받은 정의(체크포인트 되돌리기, AI 초안 등)로 캔버스 내용을 교체한다. undo 로 되돌릴 수 있다.
  applyFlowDefinitionWithHistory: (def: Record<string, unknown>) => void
  // Start 노드만 남기고 모든 노드/엣지를 삭제한다.
  clearAllNodesExceptStart: () => void

  // 항상 서버에서 받은 def 로 초기화한다. (브라우저 저장소는 사용하지 않음)
  initFlowEditor: (flowKey: string, def: Record<string, unknown>) => void
  // 다른 taskflow 진입 등으로 에디터를 비울 때 사용 (이전 flow 의 작업상태/undo 가 남지 않도록)
  resetFlowEditor: () => void
  // 신규 flow 생성 직후처럼 flowKey 만 바뀔 때, 현재 편집 상태를 유지한 채 키를 갱신한다.
  adoptFlowKey: (newKey: string) => void

  // 선택된 노드 전체(그룹 선택 포함) 삭제. START 는 제외된다.
  deleteSelectedNodes: () => void
  // 선택된 노드 전체(그룹 선택 포함) 복제. 복제한 개수를 반환한다. (엣지는 복제하지 않음)
  duplicateSelectedNodes: () => number
  deleteSelectedEdge: () => void
  // 선택된 엣지의 시각 유형(곡선/직선/꺾은선) 변경
  setSelectedEdgeType: (edgeType: EdgeVisualType) => void

  undo: () => void
  redo: () => void

  confirmDeleteOpen: boolean
  openDeleteConfirm: () => void
  closeDeleteConfirm: () => void
  confirmDeleteSelectedNode: () => void

  confirmDeleteEdgeOpen: boolean
  openDeleteEdgeConfirm: () => void
  closeDeleteEdgeConfirm: () => void
  confirmDeleteSelectedEdge: () => void

  alignSelectedNodesAuto: (direction?: 'horizontal' | 'vertical') => void

  // 표시 방향 모드 전환 (전환 시 자동 레이아웃 적용)
  setFlowMode: (mode: FlowMode) => void
}

// ──────────────────────────────────────────────────────────────
// Store 구현
// ──────────────────────────────────────────────────────────────

export const useFlowEditorStore = create<FlowEditorState>((set, get) => ({
  loadingTasks: false,

  tasks: [],
  palette: [],
  contentsList: [],

  groupId: null,
  siteId: null,

  nodes: [],
  edges: [],
  canvasNotes: [],
  viewport: { ...DEFAULT_VIEWPORT },

  historyPast: [],
  historyFuture: [],
  canUndo: false,
  canRedo: false,

  isDirty: false,
  markSaved: () => set({ isDirty: false }),

  flowKey: null,

  flowMode: DEFAULT_FLOW_MODE,
  positionsByMode: {},

  helperLineVertical: undefined,
  helperLineHorizontal: undefined,

  selectedNodeId: null,
  selectedEdgeId: null,
  selectedPalette: null,

  loadTasks: async (groupId: string | null, siteId: string | null) => {
    set({ loadingTasks: true, groupId, siteId })
    try {
      console.log('[TASK_PANEL][LOAD_START]', {
        groupId,
        siteId
      })

      const rawTasks = await listTasks({ groupId, siteId, include: 'contents' })
      console.log('[TASK_PANEL][LOAD_RAW]', {
        count: rawTasks.length,
        tasks: rawTasks.map((task) => ({
          id: task.id,
          name: task.name,
          taskType: task.taskType,
          contentsCount: Array.isArray((task as any)?.contents) ? (task as any).contents.length : 0
        }))
      })

      const tasks = rawTasks.map(normalizeTaskPayload)
      const { palette, contentsList } = buildPaletteAndCatalog(tasks)

      console.log('[TASK_PANEL][LOAD_BUILT]', {
        taskCount: tasks.length,
        paletteCount: palette.length,
        contentsCount: contentsList.length,
        controlTaskCount: tasks.filter((task) => task.taskType === TASK_TYPE_CONTROL).length,
        actionTaskCount: tasks.filter((task) => task.taskType === 'ACTION').length,
        rootTaskCount: tasks.filter((task) => task.taskType === TASK_TYPE_ROOT).length
      })

      // tasks 로드 전에 캔버스가 먼저 초기화된 경우, 지금 start 노드에 ROOT task 정보를 반영한다.
      set((state) => ({
        tasks,
        palette,
        contentsList,
        nodes: applyRootTaskToStartNode(state.nodes, tasks)
      }))
    } catch (e) {
      console.error('loadTasks failed:', e)
      set({ tasks: [], palette: [], contentsList: [] })
    } finally {
      set({ loadingTasks: false })
      console.log('[TASK_PANEL][LOAD_END]', {
        groupId,
        siteId
      })
    }
  },

  refreshContents: async () => {
    const { groupId, siteId, nodes, edges, viewport, flowMode } = get()

    const contentsIdsInNodes = getContentIdsInNodes(nodes)

    const { updatedContents, missingContents } = await fetchUpdatedContents(groupId, siteId, contentsIdsInNodes)

    const { nodes: nextNodes, changed, missing } = refreshContentNodes(nodes, updatedContents, missingContents)

    // 실제 바뀐 게 있을 때만 커밋(히스토리/undo + dirty)
    if (changed.length > 0) {
      const prev = makeSnapshot(nodes, edges, viewport, flowMode)
      set((state) => ({
        nodes: nextNodes,
        ...pushHistory(state.historyPast, prev)
      }))
    }

    return { changed, missing }
  },

  addNodeFromPalette: (item, position) => {
    const id = generateNodeId()
    const nodeData = buildNodeDataFromPaletteItem(item)

    const newNode: RFNode = {
      id,
      type: 'taskNode',
      position,
      data: nodeData
    }

    const prev = makeSnapshot(get().nodes, get().edges, get().viewport, get().flowMode)
    const nextNodes = [...get().nodes, newNode]

    set((state) => ({
      nodes: nextNodes,
      selectedNodeId: id,
      selectedEdgeId: null,
      selectedPalette: null,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  addControlNodeFromTask: (task, position) => {
    const id = generateNodeId()

    const nodeData: NodeData = {
      groupId: task.groupId,
      siteId: task.siteId,
      label: task.name,
      taskId: task.id,
      taskName: task.name,
      taskType: task.taskType,
      propertySchema: task.propertySchema,
      properties: buildDefaultProperties(task)
    }

    const newNode: RFNode = {
      id,
      type: 'taskNode',
      position,
      data: nodeData
    }

    const prev = makeSnapshot(get().nodes, get().edges, get().viewport, get().flowMode)
    const nextNodes = [...get().nodes, newNode]

    set((state) => ({
      nodes: nextNodes,
      selectedNodeId: id,
      selectedEdgeId: null,
      selectedPalette: null,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  addCanvasNote: (position) => {
    set((state) => ({
      canvasNotes: [...state.canvasNotes, createCanvasNote(position)]
    }))
  },

  updateCanvasNote: (id, patch) => {
    const targetId = String(id)

    set((state) => ({
      canvasNotes: state.canvasNotes.map((note) =>
        note.id === targetId
          ? {
              ...note,
              ...patch,
              id: note.id,
              x: patch.x === undefined ? note.x : Number(patch.x),
              y: patch.y === undefined ? note.y : Number(patch.y),
              title: patch.title === undefined ? note.title : String(patch.title),
              text: patch.text === undefined ? note.text : String(patch.text),
              width: patch.width === undefined ? note.width : Number(patch.width),
              height: patch.height === undefined ? note.height : Number(patch.height)
            }
          : note
      )
    }))
  },

  removeCanvasNote: (id) => {
    const targetId = String(id)

    set((state) => ({
      canvasNotes: state.canvasNotes.filter((note) => note.id !== targetId)
    }))
  },

  selectNode: (id) =>
    set({
      selectedNodeId: id,
      selectedEdgeId: null,
      selectedPalette: null
    }),

  selectEdge: (id) =>
    set({
      selectedEdgeId: id,
      selectedNodeId: null,
      selectedPalette: null
    }),

  selectPalette: (item) =>
    set({
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: item ? buildNodeDataFromPaletteItem(item) : null
    }),

  // 그룹 선택에 노드 하나를 추가한다.
  addNodeToSelection: (id) => {
    const targetId = String(id)

    set((state) => ({
      nodes: state.nodes.map((node) => (String(node.id) === targetId ? { ...node, selected: true } : node)),
      selectedNodeId: state.selectedNodeId === targetId ? state.selectedNodeId : null,
      selectedEdgeId: null
    }))
  },

  // 그룹 선택에 엣지 하나를 추가한다.
  addEdgeToSelection: (id) => {
    const targetId = String(id)

    set((state) => ({
      edges: state.edges.map((edge) => (String(edge.id) === targetId ? { ...edge, selected: true } : edge)),
      selectedEdgeId: state.selectedEdgeId === targetId ? state.selectedEdgeId : null,
      selectedNodeId: null
    }))
  },

  // 그룹 선택에서 노드 하나만 제외한다. (나머지 그룹은 그대로 유지)
  // - 그룹 상태(node.selected) 해제는 React Flow 기본 동작이 이미 처리하지만,
  //   단일 선택(selectedNodeId) 으로 남아 있으면 삭제/복제 대상에 계속 포함되므로 함께 정리한다.
  // - 엣지는 박스 드래그와 같은 기준("그룹 노드에 하나라도 붙어 있으면 그룹")으로 다시 맞춘다.
  //   즉 빠진 노드에 붙은 엣지 중, 반대쪽 끝도 그룹 밖인 엣지만 그룹에서 뺀다.
  removeNodeFromSelection: (id) => {
    const targetId = String(id)

    set((state) => {
      const nodes = state.nodes.map((node) =>
        String(node.id) === targetId && node.selected ? { ...node, selected: false } : node
      )

      const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => String(node.id)))

      const edges = state.edges.map((edge) => {
        if (!edge.selected) return edge

        const source = String(edge.source)
        const target = String(edge.target)
        if (source !== targetId && target !== targetId) return edge
        if (selectedNodeIds.has(source) || selectedNodeIds.has(target)) return edge

        return { ...edge, selected: false }
      })

      return {
        nodes,
        edges,
        selectedNodeId: state.selectedNodeId === targetId ? null : state.selectedNodeId
      }
    })
  },

  // 그룹 선택에서 엣지 하나만 제외한다.
  removeEdgeFromSelection: (id) => {
    const targetId = String(id)

    set((state) => ({
      edges: state.edges.map((edge) =>
        String(edge.id) === targetId && edge.selected ? { ...edge, selected: false } : edge
      ),
      selectedEdgeId: state.selectedEdgeId === targetId ? null : state.selectedEdgeId
    }))
  },

  updateSelectedNodeProps: (patch) => {
    const { selectedNodeId, nodes, edges, viewport } = get()
    if (!selectedNodeId) return

    const prev = makeSnapshot(nodes, edges, viewport, get().flowMode)

    const nextNodes = nodes.map((node) => {
      if (node.id !== selectedNodeId) return node

      return {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...(node.data?.properties ?? {}),
            ...patch
          }
        }
      }
    })

    set((state) => ({
      nodes: nextNodes,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setCanvasNotes: (canvasNotes) => set({ canvasNotes }),
  setViewport: (viewport) => set({ viewport: normalizeViewport(viewport) }),

  loadFromFlowDefinition: (def) => {
    const tasks = get().tasks
    const safeDef = ensureStartNode(def, tasks)

    const rawNodes = Array.isArray((safeDef as any).nodes) ? ((safeDef as any).nodes as RFNode[]) : []
    const nodes = applyRootTaskToStartNode(rawNodes, tasks)

    const edges = Array.isArray((safeDef as any).edges) ? ((safeDef as any).edges as RFEdge[]) : []
    const canvasNotes = Array.isArray((safeDef as any).canvasNotes)
      ? ((safeDef as any).canvasNotes as CanvasNote[]).map(normalizeCanvasNote)
      : []
    const viewport = normalizeViewport((safeDef as any).viewport)

    const flowMode = normalizeFlowMode((safeDef as any).flowMode)

    set({
      nodes,
      edges,
      canvasNotes,
      viewport,
      flowMode,
      positionsByMode: {},
      helperLineVertical: undefined,
      helperLineHorizontal: undefined,
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null,
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
      isDirty: false
    })
  },

  applyFlowDefinitionWithHistory: (def) => {
    const { nodes, edges, viewport, flowMode, tasks } = get()
    const prev = makeSnapshot(nodes, edges, viewport, flowMode)

    const safeDef = ensureStartNode(def, tasks)
    const rawNodes = Array.isArray((safeDef as any).nodes) ? ((safeDef as any).nodes as RFNode[]) : []
    const canvasNotes = Array.isArray((safeDef as any).canvasNotes)
      ? ((safeDef as any).canvasNotes as CanvasNote[]).map(normalizeCanvasNote)
      : get().canvasNotes

    set((state) => ({
      nodes: applyRootTaskToStartNode(rawNodes, tasks),
      edges: Array.isArray((safeDef as any).edges) ? ((safeDef as any).edges as RFEdge[]) : [],
      canvasNotes,
      viewport: normalizeViewport((safeDef as any).viewport ?? viewport),
      flowMode: normalizeFlowMode((safeDef as any).flowMode ?? flowMode),
      positionsByMode: {},
      helperLineVertical: undefined,
      helperLineHorizontal: undefined,
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  clearAllNodesExceptStart: () => {
    const { nodes, edges, viewport, flowMode } = get()

    // id 가 'start' 가 아닌 예전 정의도 있어 노드 타입까지 함께 본다. Start 는 어떤 경우에도 남긴다.
    const isStartNode = (node: Node) =>
      isStartNodeId(String(node.id)) || String((node as any)?.type ?? '') === 'startNode'
    const startNodes = nodes.filter((node) => isStartNode(node))
    if (startNodes.length === nodes.length && edges.length === 0) return

    const prev = makeSnapshot(nodes, edges, viewport, flowMode)
    // Start 가 아예 없던 캔버스라면 새로 만들어 남긴다. 지우고 나서 Start 까지 사라지면 아무 것도 이을 수 없다.
    const keptStartNodes = startNodes.length > 0 ? startNodes : (ensureStartNode(null, get().tasks).nodes as Node[])

    set((state) => ({
      nodes: keptStartNodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
      edges: [],
      canvasNotes: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  initFlowEditor: (flowKey, def) => {
    // 브라우저 저장소를 쓰지 않으므로 항상 서버에서 내려온 def 가 유일한 소스다.
    // (저장하지 않은 편집 내용은 페이지를 벗어나면 사라진다)
    set({ flowKey })
    get().loadFromFlowDefinition(def)
  },

  resetFlowEditor: () =>
    set({
      flowKey: null,
      flowMode: DEFAULT_FLOW_MODE,
      positionsByMode: {},
      helperLineVertical: undefined,
      helperLineHorizontal: undefined,
      nodes: [],
      edges: [],
      canvasNotes: [],
      viewport: { ...DEFAULT_VIEWPORT },
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
      isDirty: false,
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null
    }),

  adoptFlowKey: (newKey) => {
    // 신규 flow 저장 직후 'new' → '{id}' 로 키만 갈아끼운다. 편집 상태는 메모리에 그대로 유지된다.
    set({ flowKey: newKey })
  },

  applyNodesChange: (changes) => {
    const safeChanges = changes.filter((c) => {
      if (!('id' in c)) return true
      if (!isStartNodeId(c.id)) return true
      return c.type !== 'remove'
    })

    if (safeChanges.length === 0) return

    // 단일 노드 위치 변경(드래그)이면 정렬 보조: 가까운 노드에 스냅하고 가이드선 좌표를 계산한다.
    // change.position 을 직접 보정한 뒤 applyNodeChanges 에 넘긴다(공식 helper-lines 패턴).
    let helperLineVertical: number | undefined = undefined
    let helperLineHorizontal: number | undefined = undefined

    const positionChanges = safeChanges.filter((c) => c.type === 'position' && (c as any).position)
    if (positionChanges.length === 1) {
      const change = positionChanges[0] as any
      const helper = getHelperLines(change.position, String(change.id), get().nodes)

      if (helper.snapX !== undefined) change.position.x = helper.snapX
      if (helper.snapY !== undefined) change.position.y = helper.snapY

      // 가이드선은 드래그 중에만 표시 (드래그 종료 시점에는 스냅만 적용하고 선은 감춘다)
      if (change.dragging) {
        helperLineVertical = helper.vertical
        helperLineHorizontal = helper.horizontal
      }
    }

    const next = applyNodeChanges(safeChanges, get().nodes) as RFNode[]

    const hasMeaningfulChange = safeChanges.some((c) => {
      // 선택/측정(dimensions)은 undo 대상이 아니다.
      // 특히 'dimensions'는 노드가 마운트·측정될 때마다 발생하므로
      // 히스토리에 쌓이면 undo를 끝까지 해도 canUndo가 다시 true가 된다.
      if (c.type === 'select') return false
      if (c.type === 'dimensions') return false
      // 드래그 '중'에는 쌓지 않고, 드래그가 끝난 시점(position && !dragging)에만 쌓는다.
      if (c.type === 'position' && (c as any).dragging === true) return false
      return true
    })

    if (!hasMeaningfulChange) {
      set({ nodes: next, helperLineVertical, helperLineHorizontal })
      return
    }

    const prev = makeSnapshot(get().nodes, get().edges, get().viewport, get().flowMode)

    set((state) => ({
      nodes: next,
      helperLineVertical,
      helperLineHorizontal,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  applyEdgesChange: (changes) => {
    if (changes.length === 0) return

    const removedEdgeIds = new Set(
      changes.filter((c) => c.type === 'remove' && 'id' in c).map((c) => String((c as any).id))
    )

    const hasMeaningfulChange = changes.some((c) => c.type !== 'select')
    const nextEdges = applyEdgeChanges(changes, get().edges)

    const removedEdges =
      removedEdgeIds.size > 0 ? get().edges.filter((edge) => removedEdgeIds.has(String(edge.id))) : []
    const nextNodes =
      removedEdges.length > 0 ? adjustParallelCountsForRemovedChildren(get().nodes, removedEdges) : get().nodes

    if (!hasMeaningfulChange) {
      set({ nodes: nextNodes, edges: nextEdges })
      return
    }

    const prev = makeSnapshot(get().nodes, get().edges, get().viewport, get().flowMode)

    set((state) => ({
      nodes: nextNodes,
      edges: nextEdges,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  connectEdge: (connection) => {
    const nodes = get().nodes
    const edges = get().edges
    const denyReason = getConnectDenyReason(nodes, edges, connection)
    if (denyReason) return denyReason

    const edgeWithArrow: RFEdge = {
      id: nextUniqueId(new Set(edges.map((edge) => String(edge.id)))),
      source: connection.source ?? '',
      target: connection.target ?? '',
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      data: {
        sourceNodeId: connection.source ?? null,
        targetNodeId: connection.target ?? null,
        sourceHandleId: connection.sourceHandle ?? null,
        targetHandleId: connection.targetHandle ?? null,
        edgeType: DEFAULT_EDGE_TYPE
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 10,
        height: 10,
        color: '#94a3b8'
      },
      style: {
        stroke: '#94a3b8',
        strokeWidth: 1.25
      }
    }

    const next = addEdge(edgeWithArrow, edges)
    const prev = makeSnapshot(nodes, edges, get().viewport, get().flowMode)

    const nextBranchRoles =
      connection.source && connection.sourceHandle === 'left'
        ? resolveIfThenElseBranchRoles(connection.source, nodes, next, get().flowMode)
        : null

    set((state) => {
      const nextNodes = nextBranchRoles
        ? state.nodes.map((node) => {
            if (String(node.id) !== String(connection.source)) return node

            const previousProperties = (node.data?.properties ?? {}) as Record<string, unknown>
            return {
              ...node,
              data: {
                ...node.data,
                properties: {
                  ...previousProperties,
                  ifthenelse_branch_roles: nextBranchRoles
                }
              }
            }
          })
        : state.nodes

      return {
        nodes: nextNodes,
        edges: next,
        ...pushHistory(state.historyPast, prev)
      }
    })

    return null
  },

  reconnectEdge: (oldEdge, newConnection) => {
    const denyReason = getConnectDenyReason(get().nodes, get().edges, newConnection, oldEdge.id)
    if (denyReason) return denyReason

    const prev = makeSnapshot(get().nodes, get().edges, get().viewport, get().flowMode)
    const reconnected = reconnectEdgeHelper(oldEdge, newConnection, get().edges)

    // 끝점이 바뀌었으니 data 의 연결 메타를 갱신하고, 기존 경유점은 의미가 없어지므로 제거한다.
    const next = reconnected.map((edge) =>
      edge.id === oldEdge.id
        ? {
            ...edge,
            data: {
              ...edge.data,
              sourceNodeId: newConnection.source ?? null,
              targetNodeId: newConnection.target ?? null,
              sourceHandleId: newConnection.sourceHandle ?? null,
              targetHandleId: newConnection.targetHandle ?? null,
              waypoints: undefined
            }
          }
        : edge
    ) as RFEdge[]

    set((state) => ({
      edges: next,
      ...pushHistory(state.historyPast, prev)
    }))

    return null
  },

  setEdgeWaypoints: (edgeId, waypoints) => {
    set((state) => ({
      edges: state.edges.map((edge) => (edge.id === edgeId ? { ...edge, data: { ...edge.data, waypoints } } : edge))
    }))
  },

  setHelperLines: (vertical, horizontal) => {
    set({ helperLineVertical: vertical, helperLineHorizontal: horizontal })
  },

  pushHistoryCheckpoint: () => {
    const prev = makeSnapshot(get().nodes, get().edges, get().viewport, get().flowMode)
    set((state) => ({ ...pushHistory(state.historyPast, prev) }))
  },

  getSelectedNode: () => {
    const { selectedNodeId, nodes } = get()
    if (!selectedNodeId) return null
    return nodes.find((node) => node.id === selectedNodeId) ?? null
  },

  deleteSelectedNodes: () => {
    const { selectedNodeId, nodes, edges, viewport } = get()

    const targetIds = getEditableSelectedNodeIds(nodes, selectedNodeId)
    if (targetIds.length === 0) return

    const targets = new Set(targetIds)
    const prev = makeSnapshot(nodes, edges, viewport, get().flowMode)

    const removedChildEdges = edges.filter(
      (edge) =>
        String(edge.sourceHandle ?? '') === 'left' &&
        !targets.has(String(edge.source)) &&
        targets.has(String(edge.target))
    )

    const nextNodes = adjustParallelCountsForRemovedChildren(
      nodes.filter((node) => !targets.has(String(node.id))),
      removedChildEdges
    )

    // 삭제된 노드에 붙어 있던 엣지도 함께 정리한다.
    const nextEdges = edges.filter((edge) => !targets.has(String(edge.source)) && !targets.has(String(edge.target)))

    set((state) => ({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  duplicateSelectedNodes: () => {
    const { selectedNodeId, nodes, edges, viewport, flowMode } = get()

    const targetIds = getEditableSelectedNodeIds(nodes, selectedNodeId)
    if (targetIds.length === 0) return 0

    const targets = new Set(targetIds)
    const sourceNodes = nodes.filter((node) => targets.has(String(node.id)))
    const offset = computeDuplicateOffset(sourceNodes, nodes, flowMode)

    const usedNodeIds = new Set(nodes.map((node) => String(node.id)))

    // 원본 id → 복제본 id. 엣지 복제 시 양 끝점을 새 id 로 바꿔 붙이기 위해 필요하다.
    const idMap = new Map<string, string>()

    const copies: RFNode[] = sourceNodes.map((node) => {
      const id = nextUniqueId(usedNodeIds)
      idMap.set(String(node.id), id)

      return {
        ...node,
        id,
        position: {
          x: Number(node.position?.x ?? 0) + offset.x,
          y: Number(node.position?.y ?? 0) + offset.y
        },
        // properties 등 중첩 객체를 원본과 공유하지 않도록 깊은 복사한다.
        data: cloneNodeData(node.data),
        selected: true,
        dragging: false
      }
    })

    // 그룹 안에서 양 끝점이 모두 복제된 엣지는 복제본끼리 다시 연결해 준다.
    // (한쪽 끝만 선택된 엣지는 대상이 모호하므로 복제하지 않는다)
    const usedEdgeIds = new Set(edges.map((edge) => String(edge.id)))
    const edgeCopies: RFEdge[] = []

    edges.forEach((edge) => {
      const nextSource = idMap.get(String(edge.source))
      const nextTarget = idMap.get(String(edge.target))
      if (!nextSource || !nextTarget) return

      edgeCopies.push({
        ...edge,
        id: nextUniqueId(usedEdgeIds),
        source: nextSource,
        target: nextTarget,
        selected: false,
        data: {
          ...(edge.data ?? {}),
          sourceNodeId: nextSource,
          targetNodeId: nextTarget,
          // 경유점(waypoint)도 노드와 같은 만큼 이동시켜 원본과 같은 모양을 유지한다.
          waypoints: Array.isArray(edge.data?.waypoints)
            ? edge.data.waypoints.map((point) => ({
                x: Number(point?.x ?? 0) + offset.x,
                y: Number(point?.y ?? 0) + offset.y
              }))
            : edge.data?.waypoints
        }
      })
    })

    const prev = makeSnapshot(nodes, edges, viewport, flowMode)

    // 원본 선택은 해제하고 복제본만 선택 상태로 남겨, 바로 이어서 이동/삭제할 수 있게 한다.
    const nextNodes = [...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...copies]
    const nextEdges = [...edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)), ...edgeCopies]

    set((state) => ({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: copies[0]?.id ?? null,
      selectedEdgeId: null,
      selectedPalette: null,
      ...pushHistory(state.historyPast, prev)
    }))

    return copies.length
  },

  deleteSelectedEdge: () => {
    const { selectedEdgeId, nodes, edges, viewport } = get()
    if (!selectedEdgeId) return

    const removedEdge = edges.find((edge) => edge.id === selectedEdgeId)
    const prev = makeSnapshot(nodes, edges, viewport, get().flowMode)
    const nextNodes = removedEdge ? adjustParallelCountsForRemovedChildren(nodes, [removedEdge]) : nodes

    set((state) => ({
      nodes: nextNodes,
      edges: edges.filter((edge) => edge.id !== selectedEdgeId),
      selectedEdgeId: null,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  setSelectedEdgeType: (edgeType) => {
    const { selectedEdgeId, edges, nodes, viewport } = get()
    if (!selectedEdgeId) return

    const target = edges.find((edge) => edge.id === selectedEdgeId)
    if (!target || (target.data?.edgeType ?? DEFAULT_EDGE_TYPE) === edgeType) return

    const prev = makeSnapshot(nodes, edges, viewport, get().flowMode)

    const nextEdges = edges.map((edge) =>
      edge.id === selectedEdgeId ? { ...edge, data: { ...edge.data, edgeType } } : edge
    )

    set((state) => ({
      edges: nextEdges,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  undo: () => {
    const { historyPast, nodes, edges, viewport, flowMode, historyFuture } = get()
    if (historyPast.length === 0) return

    const previous = historyPast[historyPast.length - 1]
    const current = makeSnapshot(nodes, edges, viewport, flowMode)
    const nextPast = historyPast.slice(0, -1)
    const nextFuture = [current, ...historyFuture].slice(0, HISTORY_LIMIT)
    const previousSnapshot = cloneSnapshot(previous)

    set({
      nodes: previousSnapshot.nodes,
      edges: previousSnapshot.edges,
      viewport: previousSnapshot.viewport,
      flowMode: normalizeFlowMode(previousSnapshot.flowMode),
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null,
      historyPast: nextPast,
      historyFuture: nextFuture,
      canUndo: nextPast.length > 0,
      canRedo: nextFuture.length > 0
    })
  },

  redo: () => {
    const { historyFuture, nodes, edges, viewport, flowMode, historyPast } = get()
    if (historyFuture.length === 0) return

    const next = historyFuture[0]
    const current = makeSnapshot(nodes, edges, viewport, flowMode)
    const nextFuture = historyFuture.slice(1)
    const nextPast = [...historyPast, current].slice(-HISTORY_LIMIT)
    const nextSnapshot = cloneSnapshot(next)

    set({
      nodes: nextSnapshot.nodes,
      edges: nextSnapshot.edges,
      viewport: nextSnapshot.viewport,
      flowMode: normalizeFlowMode(nextSnapshot.flowMode),
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedPalette: null,
      historyPast: nextPast,
      historyFuture: nextFuture,
      canUndo: nextPast.length > 0,
      canRedo: nextFuture.length > 0
    })
  },

  confirmDeleteOpen: false,

  openDeleteConfirm: () => {
    const { nodes, selectedNodeId } = get()
    if (getEditableSelectedNodeIds(nodes, selectedNodeId).length === 0) return
    set({ confirmDeleteOpen: true })
  },

  closeDeleteConfirm: () => set({ confirmDeleteOpen: false }),

  confirmDeleteSelectedNode: () => {
    set({ confirmDeleteOpen: false })
    get().deleteSelectedNodes()
  },

  confirmDeleteEdgeOpen: false,

  openDeleteEdgeConfirm: () => {
    const { selectedEdgeId } = get()
    if (!selectedEdgeId) return
    set({ confirmDeleteEdgeOpen: true })
  },

  closeDeleteEdgeConfirm: () => set({ confirmDeleteEdgeOpen: false }),

  confirmDeleteSelectedEdge: () => {
    set({ confirmDeleteEdgeOpen: false })
    get().deleteSelectedEdge()
  },

  alignSelectedNodesAuto: (direction = 'horizontal') => {
    const { nodes, edges, viewport } = get()

    const selectedNodes = nodes.filter((node) => node.selected)
    if (selectedNodes.length < 2) return

    const prev = makeSnapshot(nodes, edges, viewport, get().flowMode)
    const positionById = computeAlignedGridPositions(selectedNodes, direction)

    const nextNodes = nodes.map((node) => {
      const position = positionById.get(node.id)
      return node.selected && position ? { ...node, position } : node
    })

    set((state) => ({
      nodes: nextNodes,
      ...pushHistory(state.historyPast, prev)
    }))
  },

  setFlowMode: (mode) => {
    const safeMode: FlowMode = 'default'
    const { flowMode, nodes, edges, viewport, positionsByMode } = get()
    if (flowMode === safeMode) return

    const prev = makeSnapshot(nodes, edges, viewport, flowMode)

    // 1) 떠나는(현재) 모드의 노드 위치를 기억해 둔다
    const currentPositions: Record<string, XYPosition> = {}
    for (const node of nodes) {
      currentPositions[node.id] = { x: node.position?.x ?? 0, y: node.position?.y ?? 0 }
    }
    const nextPositionsByMode = { ...positionsByMode, [flowMode]: currentPositions }

    // 2) 세로 모드는 비활성화되므로 기본 가로 레이아웃만 유지한다.
    const base = computeLayeredPositions(nodes, edges, 'horizontal')
    const nextNodes = nodes.map((node) => {
      const position = base.get(node.id)
      return position ? { ...node, position } : node
    })

    set((state) => ({
      flowMode: safeMode,
      nodes: nextNodes,
      positionsByMode: nextPositionsByMode,
      ...pushHistory(state.historyPast, prev)
    }))
  }
}))

export { buildDefaultProperties, generateNodeId, buildNodeDataFromPaletteItem }
