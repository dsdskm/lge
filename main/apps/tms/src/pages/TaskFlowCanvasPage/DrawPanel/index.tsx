import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import styled from 'styled-components'
import { Button } from '@repo/ui'
import { AI_TASKFLOW_REFRESH_CONTENTS_EVENT } from '@repo/constants'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ViewportPortal,
  useReactFlow,
  useUpdateNodeInternals,
  type ReactFlowInstance,
  type OnInit,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  ConnectionMode,
  ConnectionLineType,
  MarkerType,
  SelectionMode,
} from '@xyflow/react'

import TaskEdge from './Edge/TaskEdge'
import TaskNode from './Node/TaskNode'
import StartNode from './Node/StartNode'
import HelperLines from './HelperLines'
import {
  CanvasWrapper,
  FlowFill,
  PanelRoot,
  AlignOverlay,
  AlignHintText,
  NodeActionOverlay,
  CanvasNoteLayer,
  CanvasNoteCard,
  CanvasNoteHeader,
  CanvasNoteHeaderActions,
  CanvasNoteTitleInput,
  CanvasNoteDeleteButton,
  CanvasNoteTextarea,
  CanvasNoteResizeHandle,
  CanvasNoteColorButton
} from './styles'
import ConfirmModal from '@/pages/components/modal/ConfirmModal'
import { countEditableSelectedNodes, useFlowEditorStore } from '@/store/taskflow.canvas.store'
import type { CanvasNote, ConnectDenyReason, RFEdge } from '@/store/taskflow.canvas.store'
import type { ContentChange, MissingContent } from '@/utils/refreshTaskflowContents'
import { PaletteItem } from '@/types/palette'

const DND_MIME = 'application/x-taskflow-palette'
const NOTE_COLORS = ['#fef3c7', '#fee2e2', '#dbeafe', '#dcfce7', '#ede9fe']

const nodeTypes: NodeTypes = { taskNode: TaskNode, startNode: StartNode }
const edgeTypes: EdgeTypes = { taskEdge: TaskEdge }

type CanvasNotesProps = {
  selectedNoteId: string | null
  onSelectNote: (id: string | null) => void
  onRequestDeleteNote: (id: string) => void
}

function CanvasNotes({ selectedNoteId, onSelectNote, onRequestDeleteNote }: CanvasNotesProps) {
  const notes = useFlowEditorStore((s) => s.canvasNotes)
  const updateCanvasNote = useFlowEditorStore((s) => s.updateCanvasNote)
  const { screenToFlowPosition } = useReactFlow()

  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const resizeRef = useRef<{ id: string; startX: number; startY: number; width: number; height: number } | null>(null)
  const [, forceTick] = useState(0)

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const dragging = dragRef.current
      const resizing = resizeRef.current

      if (dragging) {
        const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        updateCanvasNote(dragging.id, {
          x: pos.x - dragging.offsetX,
          y: pos.y - dragging.offsetY
        })
        forceTick((value) => value + 1)
      }

      if (resizing) {
        const nextWidth = Math.max(160, Math.round(resizing.width + (event.clientX - resizing.startX)))
        const nextHeight = Math.max(110, Math.round(resizing.height + (event.clientY - resizing.startY)))
        updateCanvasNote(resizing.id, {
          width: nextWidth,
          height: nextHeight
        })
        forceTick((value) => value + 1)
      }
    }

    const handleUp = () => {
      dragRef.current = null
      resizeRef.current = null
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [screenToFlowPosition, updateCanvasNote])

  if (notes.length === 0) return null

  return (
    <ViewportPortal>
      <CanvasNoteLayer>
        {notes.map((note: CanvasNote) => (
          <CanvasNoteCard
            key={note.id}
            $selected={selectedNoteId === note.id}
            style={{
              left: note.x,
              top: note.y,
              width: note.width,
              height: note.height,
              background: `linear-gradient(180deg, ${note.color}, ${note.color}dd)`
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelectNote(note.id)
            }}
          >
            <CanvasNoteHeader
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()

                const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
                dragRef.current = {
                  id: note.id,
                  offsetX: pos.x - note.x,
                  offsetY: pos.y - note.y
                }
              }}
            >
              <CanvasNoteTitleInput
                value={note.title ?? '메모'}
                placeholder="메모"
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => updateCanvasNote(note.id, { title: event.target.value })}
              />
              <CanvasNoteHeaderActions>
                {NOTE_COLORS.map((color) => (
                  <CanvasNoteColorButton
                    key={color}
                    type="button"
                    $swatch={color}
                    $active={note.color === color}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      updateCanvasNote(note.id, { color })
                    }}
                    title={color}
                    aria-label={color}
                  />
                ))}
              </CanvasNoteHeaderActions>
            </CanvasNoteHeader>
            <CanvasNoteDeleteButton
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRequestDeleteNote(note.id)
              }}
              aria-label="메모 삭제"
              title="메모 삭제"
            >
              ×
            </CanvasNoteDeleteButton>
            <CanvasNoteTextarea
              value={note.text}
              placeholder="메모를 입력하세요"
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => updateCanvasNote(note.id, { text: event.target.value })}
            />
            <CanvasNoteResizeHandle
              role="button"
              aria-label="메모 크기 조절"
              title="드래그해서 메모 크기 조절"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                resizeRef.current = {
                  id: note.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  width: note.width,
                  height: note.height
                }
              }}
            />
          </CanvasNoteCard>
        ))}
      </CanvasNoteLayer>
    </ViewportPortal>
  )
}

function InnerCanvas() {
  const { t } = useTranslation(['tms', 'common'])
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const rfRef = useRef<ReactFlowInstance<any, any> | null>(null)
  const didRestoreViewportRef = useRef(false)

  // AI 노드 추가 후 해당 노드들이 보이도록 fitView를 호출하는 전역 핸들러
  useEffect(() => {
    ;(window as any).__AI_TASKFLOW_FIT_NODES__ = (nodeIds: string[]) => {
      if (!rfRef.current || nodeIds.length === 0) return
      requestAnimationFrame(() => {
        rfRef.current?.fitView({
          nodes: nodeIds.map((id) => ({ id })),
          padding: 0.25,
          duration: 350,
          maxZoom: 1.2
        })
      })
    }
    return () => {
      delete (window as any).__AI_TASKFLOW_FIT_NODES__
    }
  }, [])

  const [selectedNodeCount, setSelectedNodeCount] = useState(0)
  const [showAlignGuideModal, setShowAlignGuideModal] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [showNoteDeleteConfirm, setShowNoteDeleteConfirm] = useState(false)

  const nodes = useFlowEditorStore((s) => s.nodes)
  const edges = useFlowEditorStore((s) => s.edges)
  const addCanvasNote = useFlowEditorStore((s) => s.addCanvasNote)
  const removeCanvasNote = useFlowEditorStore((s) => s.removeCanvasNote)
  const viewport = useFlowEditorStore((s) => s.viewport)
  const setViewport = useFlowEditorStore((s) => s.setViewport)

  const addNodeFromPalette = useFlowEditorStore((s) => s.addNodeFromPalette)
  const addControlNodeFromTask = useFlowEditorStore((s) => s.addControlNodeFromTask)

  const selectedNodeId = useFlowEditorStore((s) => s.selectedNodeId)
  const selectedEdgeId = useFlowEditorStore((s) => s.selectedEdgeId)

  const selectNode = useFlowEditorStore((s) => s.selectNode)
  const selectEdge = useFlowEditorStore((s) => s.selectEdge)

  const applyNodesChange = useFlowEditorStore((s) => s.applyNodesChange)
  const applyEdgesChange = useFlowEditorStore((s) => s.applyEdgesChange)
  const connectEdge = useFlowEditorStore((s) => s.connectEdge)
  const reconnectEdge = useFlowEditorStore((s) => s.reconnectEdge)

  const openDeleteConfirm = useFlowEditorStore((s) => s.openDeleteConfirm)
  const openDeleteEdgeConfirm = useFlowEditorStore((s) => s.openDeleteEdgeConfirm)

  const duplicateSelectedNodes = useFlowEditorStore((s) => s.duplicateSelectedNodes)
  const refreshContents = useFlowEditorStore((s) => s.refreshContents)

  // 콘텐츠 갱신 중 & 갱신 결과(갱신됨/갱신못함)를 담아 결과 팝업으로 표시
  const [refreshingContents, setRefreshingContents] = useState(false)
  const [refreshResult, setRefreshResult] = useState<{
    changed: ContentChange[]
    missing: MissingContent[]
  } | null>(null)

  // 단일 선택 + 그룹 선택을 합친 편집 대상 개수 (START 제외)
  const editableSelectedCount = useFlowEditorStore(countEditableSelectedNodes)
  const hasEditableSelection = editableSelectedCount > 0

  const alignSelectedNodesAuto = useFlowEditorStore((s) => s.alignSelectedNodesAuto)

  const flowMode = useFlowEditorStore((s) => s.flowMode)
  const setFlowMode = useFlowEditorStore((s) => s.setFlowMode)
  const updateNodeInternals = useUpdateNodeInternals()
  const modeInitRef = useRef(true)

  const helperLineVertical = useFlowEditorStore((s) => s.helperLineVertical)
  const helperLineHorizontal = useFlowEditorStore((s) => s.helperLineHorizontal)

  const canAlign = selectedNodeCount >= 2

  // 모드가 "전환"되면 핸들의 시각적 위치가 달라지므로 ReactFlow 내부 핸들 좌표를 갱신하고,
  // 재배치된 노드가 화면에 들어오도록 fitView 한다.
  // (초기 마운트 시에는 노드가 이미 올바른 핸들 위치로 마운트되고, viewport 복원과 충돌하므로 건너뛴다)
  useEffect(() => {
    if (modeInitRef.current) {
      modeInitRef.current = false
      return
    }

    const ids = useFlowEditorStore.getState().nodes.map((n) => n.id)
    ids.forEach((id) => updateNodeInternals(id))

    requestAnimationFrame(() => {
      rfRef.current?.fitView({ padding: 0.15, duration: 250 })

      requestAnimationFrame(() => {
        const vp = rfRef.current?.getViewport()
        if (vp) setViewport(vp)
      })
    })
  }, [flowMode, updateNodeInternals, setViewport])

  // 트리 모드에서는 들어오는 엣지 종류(주흐름 vs OR 분기)에 따라 노드 입력 핸들 위치가 달라지므로,
  // 엣지가 추가/삭제되면 해당 노드들의 핸들 좌표를 다시 계산해 엣지가 올바른 위치에 붙도록 한다.
  useEffect(() => {
    if (flowMode !== 'tree') return
    useFlowEditorStore.getState().nodes.forEach((n) => updateNodeInternals(n.id))
  }, [edges, flowMode, updateNodeInternals])

  const onInit: OnInit<any, any> = useCallback(
    (instance) => {
      rfRef.current = instance
      const currentViewport = instance.getViewport()
      setViewport(currentViewport)
    },
    [setViewport]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()

      const raw = e.dataTransfer.getData(DND_MIME)
      if (!raw) return

      const wrapper = wrapperRef.current
      const instance = rfRef.current
      if (!wrapper || !instance) return

      const position = instance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY
      })

      let item: PaletteItem
      try {
        item = JSON.parse(raw) as PaletteItem
      } catch {
        return
      }

      if (item.kind === 'contentNode') {
        addNodeFromPalette(item, position)
      }

      if (item.kind === 'controlTaskNode') {
        addControlNodeFromTask(item.task, position)
      }
    },
    [addNodeFromPalette, addControlNodeFromTask]
  )

  // 연결/재연결 실패 사유를 잠깐 떴다 사라지는 토스트로 안내한다.
  const notifyConnectDeny = useCallback(
    (denyReason: ConnectDenyReason) => {
      const messageKey =
        denyReason === 'control-bottom'
          ? 'canvas.edge.connect.denyControlBottom'
          : denyReason === 'left-not-control'
            ? 'canvas.edge.connect.denyLeftNotControl'
            : denyReason === 'target-not-left'
              ? 'canvas.edge.connect.denyTargetNotLeft'
              : denyReason === 'action-right-out-only'
                ? 'canvas.edge.connect.denyActionRightOutOnly'
                : denyReason === 'action-single-in'
                  ? 'canvas.edge.connect.denyActionSingleIn'
                  : denyReason === 'action-single-out'
                    ? 'canvas.edge.connect.denyActionSingleOut'
                    : denyReason === 'control-single-right-out'
                      ? 'canvas.edge.connect.denyControlSingleRightOut'
                      : denyReason === 'control-single-left-in'
                        ? 'canvas.edge.connect.denyControlSingleLeftIn'
                        : denyReason === 'parallel-duplicate-task'
                          ? 'canvas.edge.connect.denyParallelDuplicateTask'
                          : 'canvas.edge.connect.denyDefault'

      toast.warning(t(messageKey))
    },
    [t]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const denyReason = connectEdge(c)
      if (denyReason) notifyConnectDeny(denyReason)
    },
    [connectEdge, notifyConnectDeny]
  )

  const onReconnect = useCallback(
    (oldEdge: RFEdge, newConnection: Connection) => {
      const denyReason = reconnectEdge(oldEdge, newConnection)
      if (denyReason) notifyConnectDeny(denyReason)
    },
    [reconnectEdge, notifyConnectDeny]
  )

  const onDuplicateClick = useCallback(() => {
    if (!hasEditableSelection) {
      toast.warning(t('canvas.nodeActions.duplicateEmpty'))
      return
    }

    duplicateSelectedNodes()
  }, [duplicateSelectedNodes, hasEditableSelection, t])

  const onDeleteClick = useCallback(() => {
    if (!hasEditableSelection) {
      toast.warning(t('canvas.nodeActions.deleteEmpty'))
      return
    }

    openDeleteConfirm()
  }, [hasEditableSelection, openDeleteConfirm, t])

  // 사용 콘텐츠를 최신 버전으로 갱신. 버전 변경분은 노드에 반영(성공 토스트), 최신 목록에 없어
  // 갱신 못한 건 팝업으로 알린다. 버전 동일(스킵)은 알리지 않는다.
  const onRefreshContentsClick = useCallback(async (): Promise<{ success: boolean; message?: string }> => {
    if (refreshingContents) {
      return { success: false, message: t('canvas.nodeActions.refreshContentsLoading') }
    }
    setRefreshingContents(true)
    try {
      const { changed, missing } = await refreshContents()

      // 변경·갱신불가 모두 없으면 토스트만, 하나라도 있으면 결과 팝업으로 상세 표시
      if (changed.length === 0 && missing.length === 0) {
        toast.info(t('canvas.nodeActions.refreshContentsNoChange'))
        return { success: true, message: t('canvas.nodeActions.refreshContentsNoChange') }
      }

      if (changed.length > 0) {
        toast.success(t('canvas.nodeActions.refreshContentsDone', { count: changed.length }))
      }
      setRefreshResult({ changed, missing })
      return { success: true }
    } catch (e) {
      console.error('refreshContents failed:', e)
      toast.error(t('canvas.nodeActions.refreshContentsError'))
      return { success: false, message: t('canvas.nodeActions.refreshContentsError') }
    } finally {
      setRefreshingContents(false)
    }
  }, [refreshContents, refreshingContents, t])

  useEffect(() => {
    const onRefreshContentsCommand = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          handled?: boolean
          complete?: (result: { success: boolean; message?: string }) => void
        }>
      ).detail
      if (!detail || typeof detail.complete !== 'function') return

      detail.handled = true
      void onRefreshContentsClick().then(detail.complete)
    }

    window.addEventListener(AI_TASKFLOW_REFRESH_CONTENTS_EVENT, onRefreshContentsCommand)
    return () => {
      window.removeEventListener(AI_TASKFLOW_REFRESH_CONTENTS_EVENT, onRefreshContentsCommand)
    }
  }, [onRefreshContentsClick])

  const onAlignClick = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!canAlign) {
        setShowAlignGuideModal(true)
        return
      }

      alignSelectedNodesAuto(direction)

      requestAnimationFrame(() => {
        rfRef.current?.fitView({ padding: 0.15, duration: 250 })

        requestAnimationFrame(() => {
          const vp = rfRef.current?.getViewport()
          if (vp) setViewport(vp)
        })
      })
    },
    [alignSelectedNodesAuto, canAlign, setViewport]
  )

  const requestDeleteSelectedNote = useCallback(
    (noteId?: string) => {
      const id = noteId ?? selectedNoteId
      if (!id) return
      setSelectedNoteId(id)
      setShowNoteDeleteConfirm(true)
    },
    [selectedNoteId]
  )

  const confirmDeleteSelectedNote = useCallback(() => {
    if (!selectedNoteId) return
    removeCanvasNote(selectedNoteId)
    setSelectedNoteId(null)
    setShowNoteDeleteConfirm(false)
  }, [removeCanvasNote, selectedNoteId])

  const renderedEdges = useMemo(() => {
    return edges.map((e) => {
      // 단일 선택(selectedEdgeId) 과 박스 드래그·Ctrl 클릭으로 만든 그룹 선택(e.selected) 을 같은 강조로 표시한다.
      const isSelected = e.selected === true || e.id === selectedEdgeId

      const baseStyle = {
        ...(e.style ?? {}),
        stroke: '#94a3b8',
        strokeWidth: 1.25,
        strokeLinecap: 'round' as const
      }

      const selectedStyle = {
        ...(e.style ?? {}),
        stroke: '#475569',
        strokeWidth: 2,
        strokeLinecap: 'round' as const
      }

      return {
        ...e,
        type: 'taskEdge',
        style: isSelected ? selectedStyle : baseStyle,
        markerEnd: {
          ...(e.markerEnd as any),
          color: isSelected ? '#475569' : '#94a3b8'
        }
      }
    })
  }, [edges, selectedEdgeId])

  useEffect(() => {
    const instance = rfRef.current
    if (!instance) return

    const hasCustomViewport =
      Number(viewport?.x ?? 0) !== 0 || Number(viewport?.y ?? 0) !== 0 || Number(viewport?.zoom ?? 1) !== 1

    if (!hasCustomViewport) {
      didRestoreViewportRef.current = false
      return
    }

    if (didRestoreViewportRef.current) return

    instance.setViewport(
      {
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom
      },
      { duration: 0 }
    )

    didRestoreViewportRef.current = true
  }, [viewport])

  return (
    <>
      <CanvasWrapper
        ref={wrapperRef}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragOverCapture={(e) => e.preventDefault()}
        onDropCapture={(e) => e.preventDefault()}
        tabIndex={0}
        onKeyDownCapture={(e) => {
          const target = e.target as HTMLElement | null
          const tag = target?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
            return
          }

          // Ctrl/Cmd + D: 선택 노드(그룹 포함) 복제
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault()
            e.stopPropagation()
            onDuplicateClick()
            return
          }

          if (selectedNoteId && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault()
            e.stopPropagation()
            requestDeleteSelectedNote()
            return
          }

          if (selectedEdgeId && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault()
            e.stopPropagation()
            openDeleteEdgeConfirm()
            return
          }

          // 그룹 선택은 selectedNodeId 가 비어 있을 수 있으므로 편집 대상 개수로 판단한다.
          if (hasEditableSelection && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault()
            e.stopPropagation()
            openDeleteConfirm()
          }
        }}
      >
        <AlignOverlay>
          <Button
            type="button"
            theme="light"
            size="sm"
            onClick={() => onAlignClick('horizontal')}
            aria-disabled={!canAlign}
            title={!canAlign ? t('canvas.align.selectAtLeastTwo') : '선택 노드를 가로로 정렬'}
          >
            가로 정렬
          </Button>
          <Button
            type="button"
            theme="light"
            size="sm"
            onClick={() => onAlignClick('vertical')}
            aria-disabled={!canAlign}
            title={!canAlign ? t('canvas.align.selectAtLeastTwo') : '선택 노드를 세로로 정렬'}
          >
            세로 정렬
          </Button>
        </AlignOverlay>

        <AlignHintText>빈 곳을 더블 클릭하여 메모를 생성할 수 있습니다.</AlignHintText>

        <NodeActionOverlay>
          <Button
            type="button"
            theme="light"
            size="sm"
            onClick={onRefreshContentsClick}
            aria-disabled={refreshingContents}
            title={t('canvas.nodeActions.refreshContentsTitle')}
          >
            {refreshingContents
              ? t('canvas.nodeActions.refreshContentsLoading')
              : t('canvas.nodeActions.refreshContents')}
          </Button>
          <Button
            type="button"
            theme="light"
            size="sm"
            onClick={onDuplicateClick}
            aria-disabled={!hasEditableSelection}
            title={
              hasEditableSelection ? t('canvas.nodeActions.duplicateTitle') : t('canvas.nodeActions.duplicateEmpty')
            }
          >
            {editableSelectedCount > 1
              ? t('canvas.nodeActions.duplicateWithCount', { count: editableSelectedCount })
              : t('canvas.nodeActions.duplicate')}
          </Button>

          <Button
            type="button"
            theme="delete"
            size="sm"
            onClick={onDeleteClick}
            aria-disabled={!hasEditableSelection}
            title={hasEditableSelection ? t('canvas.nodeActions.deleteTitle') : t('canvas.nodeActions.deleteEmpty')}
          >
            {editableSelectedCount > 1
              ? t('canvas.nodeActions.deleteWithCount', { count: editableSelectedCount })
              : t('actions.delete')}
          </Button>
        </NodeActionOverlay>

        <FlowFill>
          <ReactFlow
            selectionMode={SelectionMode.Full}
            // 좌클릭 드래그 = 배경 이동, Shift 누른 상태에서만 박스 선택
            selectionOnDrag={false}
            selectionKeyCode="Shift" // 기본값이지만 의도를 명시
            panOnDrag={[0, 1]} // 0=좌클릭, 1=휠(가운데) 버튼
            // Ctrl / ⌘ 는 선택 추가·제외 키
            multiSelectionKeyCode={['Control', 'Meta']}
            // 스크롤/핀치 = 확대·축소. (화면 이동은 위 panOnDrag 로 좌클릭 드래그가 담당한다)
            //
            // panOnScroll 을 켜면 xyflow 내부에서 스크롤이 '이동'으로 배정되고
            // (isPanOnScroll = panOnScroll && !zoomActivationKeyPressed && !userSelectionActive)
            // 확대·축소는 ctrlKey 가 실린 핀치 제스처만 남는다.
            // 맥북 트랙패드의 두 손가락 스크롤 확대가 동작하지 않았던 이유라 켜지 않는다.
            zoomOnDoubleClick={false}
            style={{ width: '100%', height: '100%' }}
            nodes={nodes}
            edges={renderedEdges}
            onInit={onInit}
            onNodesChange={applyNodesChange}
            onEdgesChange={applyEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            connectionMode={ConnectionMode.Loose}
            connectionLineType={ConnectionLineType.Bezier}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{
              type: 'taskEdge',
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 10,
                height: 10,
                color: '#94a3b8'
              }
            }}
            onSelectionChange={({ nodes: selectedNodes }) => {
              setSelectedNodeCount(selectedNodes.length)
            }}
            onNodeClick={(evt, node) => {
              evt.stopPropagation()
              setSelectedNoteId(null)

              const isThisNodeCurrentlySelected = Boolean(node.selected) || selectedNodeId === node.id
              if (!isThisNodeCurrentlySelected) {
                selectNode(node.id)
              }
            }}
            onEdgeClick={(evt, edge) => {
              evt.stopPropagation()
              setSelectedNoteId(null)

              const isThisEdgeCurrentlySelected = Boolean(edge.selected) || selectedEdgeId === edge.id
              if (!isThisEdgeCurrentlySelected) {
                selectEdge(edge.id)
              }
            }}
            onPaneClick={() => {
              selectNode(null)
              selectEdge(null)
              setSelectedNoteId(null)
              setSelectedNodeCount(0)
            }}
            onDoubleClick={(event) => {
              const target = event.target as HTMLElement | null
              if (!target?.closest('.react-flow__pane')) return
              if (target.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, button, textarea, input'))
                return

              const instance = rfRef.current
              if (!instance) return

              const position = instance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY
              })

              addCanvasNote(position)
            }}
            onMoveEnd={() => {
              const instance = rfRef.current
              if (!instance) return

              const vp = instance.getViewport()
              setViewport(vp)
            }}
            fitView
            deleteKeyCode={null}
          >
            <Background />
            <MiniMap />
            <Controls />
            <CanvasNotes
              selectedNoteId={selectedNoteId}
              onSelectNote={setSelectedNoteId}
              onRequestDeleteNote={requestDeleteSelectedNote}
            />
            <HelperLines vertical={helperLineVertical} horizontal={helperLineHorizontal} />
          </ReactFlow>
        </FlowFill>
      </CanvasWrapper>

      <ConfirmModal
        open={showAlignGuideModal}
        title={t('canvas.align.guideTitle')}
        description={t('canvas.align.guideDesc')}
        showCancelButton={false}
        closeOnOverlayClick
        onCancel={() => setShowAlignGuideModal(false)}
        onConfirm={() => setShowAlignGuideModal(false)}
      />
      {/* 콘텐츠 갱신 결과: 갱신됨(이전→이후 버전) / 갱신 못함(최신 목록에 없음) */}
      <ConfirmModal
        open={!!refreshResult}
        title={t('canvas.nodeActions.refreshContentsResultTitle')}
        showCancelButton={false}
        closeOnOverlayClick
        onCancel={() => setRefreshResult(null)}
        onConfirm={() => setRefreshResult(null)}
      >
        {refreshResult && (
          <ResultBox>
            {refreshResult.changed.length > 0 && (
              <>
                <SectionTitle>
                  {t('canvas.nodeActions.refreshContentsUpdatedTitle')} ({refreshResult.changed.length})
                </SectionTitle>
                <ResultList>
                  {refreshResult.changed.map((c) => (
                    <li key={`changed-${c.id}`}>
                      <b>{c.name || t('canvas.nodeActions.refreshContentsUnnamed')}</b>
                      <span> (id: {c.id})</span>
                      <VersionChange>
                        {' '}
                        {c.fromVersion ?? '-'} → {c.toVersion ?? '-'}
                      </VersionChange>
                    </li>
                  ))}
                </ResultList>
              </>
            )}
            {refreshResult.missing.length > 0 && (
              <>
                <SectionTitle>
                  {t('canvas.nodeActions.refreshContentsMissingTitle')} ({refreshResult.missing.length})
                </SectionTitle>
                <ResultList>
                  {refreshResult.missing.map((c) => (
                    <li key={`missing-${c.id}`}>
                      <b>{c.name || t('canvas.nodeActions.refreshContentsUnnamed')}</b>
                      <span>
                        {' '}
                        (id: {c.id}, version: {c.version ?? '-'})
                      </span>
                      <em> — {t('canvas.nodeActions.refreshContentsMissingReason')}</em>
                    </li>
                  ))}
                </ResultList>
              </>
            )}
          </ResultBox>
        )}
      </ConfirmModal>
      <ConfirmModal
        open={showNoteDeleteConfirm}
        title="메모 삭제"
        description="선택한 메모를 삭제할까요?"
        closeOnOverlayClick
        onCancel={() => setShowNoteDeleteConfirm(false)}
        onConfirm={confirmDeleteSelectedNote}
      />
    </>
  )
}

const ResultBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
`

const SectionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
`

const ResultList = styled.ul`
  margin: 2px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #334155;

  li {
    margin-bottom: 4px;
  }
  span {
    color: #64748b;
  }
  em {
    color: #b45309;
    font-style: normal;
  }
`

const VersionChange = styled.span`
  && {
    color: #2563eb;
    font-weight: 600;
  }
`

export default function DrawPanel() {
  return (
    <PanelRoot>
      <ReactFlowProvider>
        <InnerCanvas />
      </ReactFlowProvider>
    </PanelRoot>
  )
}
