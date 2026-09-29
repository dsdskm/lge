import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useFlowEditorStore } from '@/store/taskflow.canvas.store'
import { SelectedData } from '../types'
import { FieldDesc } from './styles.sections'

type ParallelCountPropertyKey = 'success_count' | 'failure_count'

type ParallelCountGuideProps = {
  selectedData: SelectedData | null
  propertyKey: ParallelCountPropertyKey
  readOnly: boolean
}

type CountGuide = {
  message: string
  isError: boolean
}

function isParallelNode(selectedData: SelectedData): boolean {
  const taskType = String(selectedData.taskType ?? '').toUpperCase()
  const taskName = String(
    selectedData.taskName ??
    selectedData.label ??
    ''
  )
    .trim()
    .toLowerCase()

  return taskType === 'CONTROL' && taskName === 'parallel'
}

export default function ParallelCountGuide({
  selectedData,
  propertyKey,
  readOnly
}: ParallelCountGuideProps) {
  const { t } = useTranslation('tms')

  const selectedNodeId = useFlowEditorStore(
    (s) => s.selectedNodeId
  )

  const edges = useFlowEditorStore(
    (s) => s.edges
  )

  const guide = useMemo<CountGuide | null>(() => {
    if (!selectedData) {
      return null
    }

    if (!isParallelNode(selectedData)) {
      return null
    }

    const rawValue = selectedData.properties?.[propertyKey]

    if (
      rawValue === '' ||
      rawValue === null ||
      rawValue === undefined
    ) {
      return null
    }

    const countValue = Number(rawValue)

    if (!Number.isFinite(countValue)) {
      return null
    }

    const childIds = Array.from(
      new Set(
        edges
          .filter(
            (edge) =>
              edge.source === selectedNodeId &&
              (edge as any).sourceHandle === 'left'
          )
          .map((edge) => String(edge.target))
      )
    )

    const rawMainNodes =
      selectedData.properties?.main_nodes

    const mainNodeIds = Array.isArray(rawMainNodes)
      ? rawMainNodes.map((nodeId) => String(nodeId))
      : []

    const validMainNodeIds = new Set(
      mainNodeIds.filter((nodeId) =>
        childIds.includes(nodeId)
      )
    )

    const mainCount = validMainNodeIds.size

    if (propertyKey === 'success_count') {
      if (countValue === -1) {
        return {
          message: t(
            'canvas.property.parallelSuccessCountAuto'
          ),
          isError: false
        }
      }

      if (mainCount <= 0) {
        return {
          message: t(
            'canvas.property.parallelSuccessCountNoMain'
          ),
          isError: true
        }
      }

      if (countValue > mainCount) {
        return {
          message: t(
            'canvas.property.parallelSuccessCountInvalid',
            {
              input: countValue,
              mainCount
            }
          ),
          isError: true
        }
      }

      if (countValue < 1) {
        return null
      }

      return {
        message: t(
          'canvas.property.parallelSuccessCountGuide',
          {
            input: countValue
          }
        ),
        isError: false
      }
    }

    if (countValue === -1) {
      return {
        message: 'failure_count=-1 (자동)',
        isError: false
      }
    }

    if (mainCount <= 0) {
      return {
        message: 'Main Node가 선택되지 않았습니다.',
        isError: true
      }
    }

    if (countValue > mainCount) {
      return {
        message: `failure_count(${countValue})는 Main Node 수(${mainCount})를 초과할 수 없습니다.`,
        isError: true
      }
    }

    return null
  }, [
    selectedData,
    propertyKey,
    edges,
    selectedNodeId,
    t
  ])

  if (!guide || (readOnly && guide.isError)) {
    return null
  }

  return (
    <FieldDesc
      style={{
        color: guide.isError
          ? '#ef4444'
          : undefined
      }}
    >
      {guide.message}
    </FieldDesc>
  )
}