import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PanelRoot,
  HeaderRow,
  Subtitle,
  LoadingText,
  Sections,
  Section,
  SectionHeader,
  SectionTitle,
  SectionBodyPadded,
  ControlGrid,
  SectionBody,
  DividerList,
  TaskToggleButton,
  TaskName,
  ContentBlock,
  ContentGrid,
  Chevron,
  NodeCard,
  CardLabel,
  MoveToGrouping,
  GroupingText
} from './styles'
import { PaletteItem } from '@/types/palette'
import { useFlowEditorStore } from '@/store/taskflow.canvas.store'
import { ContentApiPayload, TaskApiPayload } from '@/types/api/taskPayload'
import { DND_FALLBACK_TEXT, DND_MIME, TASK_PANEL, TASK_TYPE_CONTROL } from '@/common/constants'
import { getSiteById } from '@/api/siteApi'
import { TaskType } from '@/types/task'

const PALETTE_COMPACT_RATIO = 0.6
const PALETTE_NARROW_RATIO = 0.4

function makePaletteLabel(kind: PaletteItem['kind'], task: TaskApiPayload, content?: ContentApiPayload) {
  if (kind === 'controlTaskNode') return task.name
  return content?.name ?? task.name
}

function parseContentValue(raw: string): unknown {
  const trimmed = raw?.trim?.() ?? ''
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return raw

  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

function getContentLabels(content: ContentApiPayload): Array<{ displayName: string; isDefault?: boolean; isUnique?: boolean }> {
  const rawValue = content?.contentValue
  if (rawValue == null) return []

  const parsed = typeof rawValue === 'string' ? parseContentValue(rawValue) : rawValue

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []

  const labelsValue = (parsed as Record<string, unknown>).labels
  if (!Array.isArray(labelsValue)) return []

  return labelsValue
    .map((label) => {
      if (typeof label === 'string') {
        const value = label.trim()
        return value ? { displayName: value } : null
      }

      if (label && typeof label === 'object') {
        const record = label as Record<string, unknown>
        const displayName = String(record.displayName ?? record.name ?? '').trim()
        if (!displayName) return null

        return {
          displayName,
          isDefault: Boolean(record.isDefault),
          isUnique: Boolean(record.isUnique)
        }
      }

      return null
    })
    .filter(Boolean) as Array<{ displayName: string; isDefault?: boolean; isUnique?: boolean }>
}

function buildLabelGroupTitleFromContent(content: ContentApiPayload, noLabelTitle: string): string | null {
  const labels = getContentLabels(content)

  if (labels.length === 0) {
    return noLabelTitle
  }

  const visibleLabels = labels
    .filter((label) => !label.isDefault && label.isUnique !== true)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'))

  if (visibleLabels.length > 0) {
    return `[${visibleLabels.map((label) => label.displayName).join('][')}]`
  }

  return noLabelTitle
}

function pickLocationValue(...candidates: Array<unknown>): string | null {
  for (const value of candidates) {
    if (value == null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

async function resolveMoveToGroupTitle(content: ContentApiPayload, noLabelTitle: string): Promise<string> {
  const rawValue = parseContentValue(content.contentValue ?? '')
  const source =
    typeof rawValue === 'object' && rawValue !== null && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {}

  const contentRecord = content as unknown as Record<string, unknown>

  const buildingId = pickLocationValue(source.buildingId, contentRecord.buildingId)
  const floorId = pickLocationValue(source.floorId, contentRecord.floorId)
  const areaId = pickLocationValue(source.areaId, contentRecord.areaId)

  if (!content.siteId || (!buildingId && !floorId && !areaId)) {
    return noLabelTitle
  }

  try {
    const response = await getSiteById(content.siteId)
    const data = (response as any)?.data ?? response
    const buildings = Array.isArray(data?.buildings) ? data.buildings : []

    const matchedBuilding = buildings.find((item: any) => {
      const id = pickLocationValue(item?.buildingId)
      return id && buildingId && String(id) === String(buildingId)
    })

    const buildingName = String(
      matchedBuilding?.buildingName ?? matchedBuilding?.building_name ?? buildingId ?? '기타'
    ).trim()

    let floorName = '기타'
    let areas: any[] = []
    if (buildingId && floorId) {
      const floors = Array.isArray(matchedBuilding?.floors) ? matchedBuilding.floors : []
      const matchedFloor = floors.find((item: any) => {
        const id = pickLocationValue(item?.floorId)
        return id && floorId && String(id) === String(floorId)
      })
      floorName = String(matchedFloor?.floorName ?? matchedFloor?.floor_name ?? floorId ?? '기타').trim()
      areas = Array.isArray(matchedFloor?.areas) ? matchedFloor.areas : []
    } else if (floorId) {
      floorName = String(floorId)
    }

    let areaName = '기타'
    if (areaId) {
      const matchedArea = areas.find((item: any) => {
        const id = pickLocationValue(item?.areaId)
        return id && String(id) === String(areaId)
      })
      areaName = String(matchedArea?.areaName ?? matchedArea?.area_name ?? areaId ?? '기타').trim()
    }

    return [buildingName, floorName, areaId ? areaName : null]
      .filter(Boolean)
      .map((name) => `[${name}]`)
      .join('')
  } catch {
    return noLabelTitle
  }
}

// 태스크 패널의 모든 목록(컨트롤/액션/컨텐츠)은 name 오름차순으로 보여준다.
function sortByNameAsc<T extends { name?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

export default function PalettePanel({ groupId, siteId }: { groupId: string | null; siteId: string | null }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const { t } = useTranslation('tms')
  const noLabelTitle = t('palette.noLabel')

  const [paletteMeasure, setPaletteMeasure] = useState({
    width: 0,
    maxWidth: 0
  })

  const loading = useFlowEditorStore((s) => s.loadingTasks)
  const tasks = useFlowEditorStore((s) => s.tasks)
  const loadTasks = useFlowEditorStore((s) => s.loadTasks)

  const selectedPalette = useFlowEditorStore((s) => s.selectedPalette)
  const selectPalette = useFlowEditorStore((s) => s.selectPalette)
  const addNodeFromPalette = useFlowEditorStore((s) => s.addNodeFromPalette)
  const addControlNodeFromTask = useFlowEditorStore((s) => s.addControlNodeFromTask)
  const nodes = useFlowEditorStore((s) => s.nodes)

  const paletteGridNarrow =
    paletteMeasure.maxWidth > 0 && paletteMeasure.width <= paletteMeasure.maxWidth * PALETTE_NARROW_RATIO
  const paletteGridCompact =
    paletteMeasure.maxWidth > 0 &&
    paletteMeasure.width <= paletteMeasure.maxWidth * PALETTE_COMPACT_RATIO &&
    !paletteGridNarrow

  const getNextCanvasPosition = () => {
    const index = nodes.length
    const col = index % 6
    const row = Math.floor(index / 6)

    return {
      x: 220 + col * 36,
      y: 120 + row * 28
    }
  }

  useEffect(() => {
    if (!groupId || !siteId) {
      setMoveToGroupsByTask({})
      return
    }

    loadTasks(groupId, siteId)
  }, [loadTasks, groupId, siteId])

  useEffect(() => {
    const el = panelRef.current

    if (!el || typeof ResizeObserver === 'undefined') {
      return
    }

    const updateWidth = (width: number) => {
      setPaletteMeasure((prev) => ({
        width,
        maxWidth: Math.max(prev.maxWidth, width)
      }))
    }

    updateWidth(el.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      updateWidth(entry.contentRect.width)
    })

    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [])

  const controlTasks = useMemo(() => sortByNameAsc(tasks.filter((t) => t.taskType === TASK_TYPE_CONTROL)), [tasks])

  const otherTasks = useMemo(() => tasks.filter((t) => t.taskType !== TASK_TYPE_CONTROL), [tasks])

  const hasContentReference = (t: TaskApiPayload) =>
    Object.values(t.propertySchema?.properties ?? {}).some((p) => p?.type === 'content_reference')

  // propertySchema.properties 중 type === 'content_reference' 가 없으면 Default,
  // 하나라도 있으면 펼침(content 단위)으로 보여준다.
  const directActionTasks = useMemo(
    () => sortByNameAsc(otherTasks.filter((t) => t.taskType === TaskType.ACTION && !hasContentReference(t))),
    [otherTasks]
  )

  const expandableTasks = useMemo(
    () =>
      sortByNameAsc(
        otherTasks.filter(
          (t) => t.taskType !== TaskType.ROOT && hasContentReference(t) && t.name !== 'PickUp' && t.name !== 'PutDown'
        )
      ),
    [otherTasks]
  )

  const [openMap, setOpenMap] = useState<Record<number, boolean>>({})
  const [closedGroupMap, setClosedGroupMap] = useState<Record<string, boolean>>({})
  const [defaultOpen, setDefaultOpen] = useState(false)
  const [moveToGroupsByTask, setMoveToGroupsByTask] = useState<
    Record<number, Array<{ key: string; title: string; contents: ContentApiPayload[]; isNoLabel: boolean }>>
  >({})

  useEffect(() => {
    let cancelled = false

    const loadMoveToGroups = async () => {
      const groupedEntries: Record<number, Array<{ key: string; title: string; contents: ContentApiPayload[]; isNoLabel: boolean }>> = {}

      for (const task of expandableTasks) {
        const normalizedName = String(task.name ?? '').toLowerCase()
        const contents = task.contents ?? []
        const moveToContents = normalizedName === 'moveto' ? contents : []

        const resolvedGroups = await Promise.all(
          contents.map(async (content) => {
            if (normalizedName === 'moveto') {
              const title = await resolveMoveToGroupTitle(content, noLabelTitle)
              const resolvedTitle = title === noLabelTitle ? String(task.name ?? 'MoveTo') : title
              return { content, title: resolvedTitle, isNoLabel: false }
            }

            const labels = getContentLabels(content)
            const normalizedLabels = labels.filter((label) => !label.isDefault && label.isUnique !== true)
            const labelTitle = buildLabelGroupTitleFromContent(content, noLabelTitle)

            if (labelTitle && normalizedLabels.length > 0) {
              return { content, title: labelTitle, isNoLabel: labelTitle === noLabelTitle }
            }

            return null
          })
        )

        const validResolvedGroups = resolvedGroups.filter(
          (entry): entry is { content: ContentApiPayload; title: string; isNoLabel: boolean } => entry !== null
        )

        const map = new Map<string, { title: string; contents: ContentApiPayload[]; isNoLabel: boolean }>()
        for (const entry of validResolvedGroups) {
          const existing = map.get(entry.title)
          if (existing) {
            existing.contents.push(entry.content)
            continue
          }

          map.set(entry.title, {
            title: entry.title,
            contents: [entry.content],
            isNoLabel: entry.isNoLabel
          })
        }

        const grouped = Array.from(map.values())
          .map(({ title, contents, isNoLabel }) => ({
            key: `${task.id}-${title}`,
            title,
            contents: sortByNameAsc(contents),
            isNoLabel
          }))
          .sort((a, b) => {
            if (a.isNoLabel) return -1
            if (b.isNoLabel) return 1
            return a.title.localeCompare(b.title, 'ko')
          })

        if (normalizedName === 'moveto') {
          console.log('[PALETTE][MOVETO_GROUP]', {
            taskId: task.id,
            taskName: task.name,
            groups: grouped.map((group) => ({
              title: group.title,
              count: group.contents.length,
              contents: group.contents.map((content) => ({
                id: (content as any).id,
                name: (content as any).name,
                siteId: (content as any).siteId,
                contentValue: (content as any).contentValue
              }))
            })),
            moveToContents: moveToContents.map((content) => ({
              id: (content as any).id,
              name: (content as any).name,
              siteId: (content as any).siteId,
              contentValue: (content as any).contentValue
            }))
          })
        }

        const unlabeledContents = contents.filter((content) => {
          const labels = getContentLabels(content)
          const isMoveToContent = String(task.name ?? '').toLowerCase() === 'moveto'
          if (isMoveToContent) return false
          return labels.length === 0 || labels.every((label) => label.isDefault || label.isUnique === true)
        })

        if (unlabeledContents.length > 0 && !grouped.some((group) => group.isNoLabel)) {
          grouped.push({
            key: `${task.id}-no-labels`,
            title: noLabelTitle,
            contents: sortByNameAsc(unlabeledContents),
            isNoLabel: true
          })
          grouped.sort((a, b) => {
            if (a.isNoLabel) return -1
            if (b.isNoLabel) return 1
            return a.title.localeCompare(b.title, 'ko')
          })
        }

        groupedEntries[task.id] = grouped
      }

      if (!cancelled) {
        setMoveToGroupsByTask(groupedEntries)
      }
    }

    void loadMoveToGroups()

    return () => {
      cancelled = true
    }
  }, [expandableTasks, noLabelTitle])

  return (
    <PanelRoot ref={panelRef}>
      <HeaderRow>
        <div>
          <Subtitle>{TASK_PANEL.SUBTITLE}</Subtitle>
        </div>
        {loading ? <LoadingText>{TASK_PANEL.LOADING}</LoadingText> : null}
      </HeaderRow>

      <Sections>
        <Section>
          <SectionHeader>
            <SectionTitle>{TASK_PANEL.SECTION_CONTROL}</SectionTitle>
          </SectionHeader>

          <SectionBodyPadded>
            <ControlGrid $compact={paletteGridCompact} $narrow={paletteGridNarrow}>
              {controlTasks.map((task) => (
                <ControlTaskNodeCard
                  key={task.id}
                  task={task}
                  selected={selectedPalette?.taskId === task.id && !selectedPalette?.contentId}
                  onSelect={selectPalette}
                  onDoubleAdd={() => addControlNodeFromTask(task, getNextCanvasPosition())}
                />
              ))}
            </ControlGrid>
          </SectionBodyPadded>
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>{TASK_PANEL.SECTION_ACTION}</SectionTitle>
          </SectionHeader>

          <SectionBody>
            <DividerList>
              {directActionTasks.length > 0 ? (
                <div>
                  <TaskToggleButton type="button" onClick={() => setDefaultOpen((prev) => !prev)} title="Default">
                    <TaskName>Default</TaskName>
                    <ChevronRight open={defaultOpen} />
                  </TaskToggleButton>

                  {defaultOpen ? (
                    <ContentBlock>
                      <ContentGrid $compact={paletteGridCompact} $narrow={paletteGridNarrow}>
                        {directActionTasks.map((task) => (
                          <ControlTaskNodeCard
                            key={task.id}
                            task={task}
                            selected={selectedPalette?.taskId === task.id && !selectedPalette?.contentId}
                            onSelect={selectPalette}
                            onDoubleAdd={() => addControlNodeFromTask(task, getNextCanvasPosition())}
                          />
                        ))}
                      </ContentGrid>
                    </ContentBlock>
                  ) : null}
                </div>
              ) : null}

              {expandableTasks.map((task) => {
                const contents = sortByNameAsc(task.contents ?? [])
                const open = openMap[task.id] ?? false
                const taskGroups =
                  moveToGroupsByTask[task.id] ??
                  [
                    {
                      key: `${task.id}-default`,
                      title: String(task.name ?? 'MoveTo'),
                      contents,
                      isNoLabel: false
                    }
                  ]
                return (
                  <div key={task.id}>
                    <TaskToggleButton
                      type="button"
                      onClick={() => setOpenMap((prev) => ({ ...prev, [task.id]: !open }))}
                      title={task.name}
                    >
                      <TaskName>{task.name}</TaskName>
                      <ChevronRight open={open} />
                    </TaskToggleButton>

                    {open ? (
                      <ContentBlock>

                        {taskGroups.map((group) => {
                          const groupTitle = group.isNoLabel
                            ? noLabelTitle
                            : group.title && group.title !== task.name
                              ? group.title
                              : null
                          const groupOpen = groupTitle ? !closedGroupMap[group.key] : true

                          return (
                            <div key={group.key}>
                              {groupTitle ? (
                                <MoveToGrouping
                                  type="button"
                                  onClick={() =>
                                    setClosedGroupMap((prev) => ({ ...prev, [group.key]: groupOpen }))
                                  }
                                  title={groupTitle}
                                >
                                  <GroupingText>{groupTitle}</GroupingText>
                                  <ChevronRight open={groupOpen} />
                                </MoveToGrouping>
                              ) : null}

                              {groupOpen ? (
                                <ContentGrid $compact={paletteGridCompact} $narrow={paletteGridNarrow}>
                                  {group.contents.map((content) => (
                                    <ContentNodeCard
                                      key={content.id}
                                      task={task}
                                      content={content}
                                      selected={
                                        selectedPalette?.taskId === task.id &&
                                        selectedPalette?.contentId === content.id
                                      }
                                      onSelect={selectPalette}
                                      onDoubleAdd={() =>
                                        addNodeFromPalette(
                                          {
                                            kind: 'contentNode',
                                            task,
                                            content,
                                            label: makePaletteLabel('contentNode', task, content)
                                          },
                                          getNextCanvasPosition()
                                        )
                                      }
                                    />
                                  ))}
                                </ContentGrid>
                              ) : null}
                            </div>
                          )
                        })}
                      </ContentBlock>
                    ) : null}
                  </div>
                )
              })}
            </DividerList>
          </SectionBody>
        </Section>
      </Sections>
    </PanelRoot>
  )
}

function ChevronRight({ open }: { open: boolean }) {
  return (
    <Chevron $open={open} aria-hidden>
      ›
    </Chevron>
  )
}

function ControlTaskNodeCard({
  task,
  selected,
  onSelect,
  onDoubleAdd
}: {
  task: TaskApiPayload
  selected: boolean
  onSelect: (item: PaletteItem | null) => void
  onDoubleAdd: () => void
}) {
  const payload: PaletteItem = {
    kind: 'controlTaskNode',
    task,
    label: makePaletteLabel('controlTaskNode', task)
  }

  return (
    <NodeCard
      draggable
      $selected={selected}
      onDragStart={(e) => {
        const json = JSON.stringify(payload)
        e.dataTransfer.setData(DND_MIME, json)
        e.dataTransfer.setData(DND_FALLBACK_TEXT, payload.label)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onSelect(payload)}
      onDoubleClick={onDoubleAdd}
      title={task.name}
    >
      <CardLabel>{task.name}</CardLabel>
    </NodeCard>
  )
}

function ContentNodeCard({
  task,
  content,
  selected,
  onSelect,
  onDoubleAdd
}: {
  task: TaskApiPayload
  content: ContentApiPayload
  selected: boolean
  onSelect: (item: PaletteItem | null) => void
  onDoubleAdd: () => void
}) {
  const payload: PaletteItem = {
    kind: 'contentNode',
    task,
    content,
    label: content.name
  }

  return (
    <NodeCard
      draggable
      $selected={selected}
      onDragStart={(e) => {
        const json = JSON.stringify(payload)
        e.dataTransfer.setData(DND_MIME, json)
        e.dataTransfer.setData(DND_FALLBACK_TEXT, payload.label)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onSelect(payload)}
      onDoubleClick={onDoubleAdd}
      title={content.name}
    >
      <CardLabel>{content.name}</CardLabel>
    </NodeCard>
  )
}
