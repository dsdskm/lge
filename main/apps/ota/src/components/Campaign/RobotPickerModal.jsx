import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Modal, Search, SearchContainer, StyledTag, Table } from '@repo/ui'
import { statusToBgColor, statusToColor } from '@/utils/common'
import { RobotPickerBody, RobotPickerHead } from './styles'

const DEFAULT_PER_PAGE = 10

/**
 * 단계별 배정 로봇 선택 모달.
 * 타겟 그룹의 로봇 풀에서 해당 단계의 배정 대수만큼 다중 선택한다.
 * 확정하지 않으면(선택 비움) BE가 순서대로 자동 분할한다.
 *
 * @param devices        선택 가능한 로봇 풀 (타겟 그룹의 ACTIVE 로봇)
 * @param requiredCount  이 단계에 배정된 대수 (선택 대수와 반드시 일치해야 한다)
 * @param excludedIds    다른 단계에 이미 배정된 로봇 ID (선택 불가)
 * @param readOnly       배포 시작 이후 등 편집 불가 상태
 */
const RobotPickerModal = ({
  isOpen,
  stageNo,
  devices = [],
  requiredCount = 0,
  initialSelectedIds = [],
  excludedIds = [],
  readOnly = false,
  onClose,
  onConfirm
}) => {
  const { t } = useTranslation('campaign')
  const { t: tCommon } = useTranslation('common')
  // 단계가 바뀔 때마다 부모가 key로 리마운트하므로 초기 선택 상태는 여기서 한 번만 세팅한다
  const [checkedIds, setCheckedIds] = useState(() => new Set(initialSelectedIds))
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE)

  const excludedIdSet = useMemo(() => new Set(excludedIds), [excludedIds])

  // 읽기 전용(배포 이후)일 때는 이 단계에 배정된 로봇만 보여준다
  const visibleDevices = useMemo(() => {
    const pool = readOnly ? devices.filter((device) => checkedIds.has(device.id)) : devices
    const query = searchQuery.trim().toLowerCase()
    if (!query) return pool
    return pool.filter((device) =>
      [device.displayName, device.thingName, device.deviceUniqueId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    )
  }, [devices, readOnly, checkedIds, searchQuery])

  const currentPageDevices = useMemo(() => {
    const start = (currentPage - 1) * perPage
    return visibleDevices.slice(start, start + perPage)
  }, [visibleDevices, currentPage, perPage])

  const isFull = checkedIds.size >= requiredCount

  // 다른 단계에 배정되었거나, 이미 배정 대수를 채운 상태의 미선택 행은 선택할 수 없다
  const isSelectable = (device) => {
    if (readOnly) return false
    if (excludedIdSet.has(device.id)) return false
    return checkedIds.has(device.id) || !isFull
  }

  const handleRowToggle = (deviceId, checked) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(deviceId)
      else next.delete(deviceId)
      return next
    })
  }

  // 전체 선택은 현재 페이지의 선택 가능한 행 기준(배정 대수를 넘지 않는 만큼만)
  const selectableInPage = currentPageDevices.filter((device) => !readOnly && !excludedIdSet.has(device.id))
  const isAllChecked = selectableInPage.length > 0 && selectableInPage.every((device) => checkedIds.has(device.id))

  const handleAllToggle = (checked) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      selectableInPage.forEach((device) => {
        if (!checked) {
          next.delete(device.id)
        } else if (next.size < requiredCount) {
          next.add(device.id)
        }
      })
      return next
    })
  }

  const columns = [
    {
      name: (
        <Checkbox
          checked={isAllChecked}
          disabled={readOnly || selectableInPage.length === 0}
          onChange={(e) => handleAllToggle(e.target.checked)}
        />
      ),
      cell: (device) => (
        <Checkbox
          checked={checkedIds.has(device.id)}
          disabled={!isSelectable(device)}
          onChange={(e) => handleRowToggle(device.id, e.target.checked)}
        />
      ),
      width: '50px'
    },
    {
      name: t('device'),
      selector: (device) => device.displayName || '-',
      sortable: 'true'
    },
    {
      name: t('deviceUniqueId'),
      selector: (device) => device.deviceUniqueId || '-',
      sortable: 'true'
    },
    {
      name: t('thingName'),
      selector: (device) => device.thingName || '-',
      sortable: 'true'
    },
    {
      name: t('status'),
      cell: (device) => (
        <StyledTag color={statusToColor(device.deviceRegStatus)} bgColor={statusToBgColor(device.deviceRegStatus)}>
          {device.deviceRegStatus || '-'}
        </StyledTag>
      ),
      grow: 0.5
    },
    {
      name: '',
      cell: (device) =>
        excludedIdSet.has(device.id) ? <span className="assignedMark">{t('assignedToOtherStage')}</span> : null,
      grow: 0.7
    }
  ]

  return (
    <Modal
      isOpen={isOpen}
      size="xl"
      title={t('selectStageRobots', { stage: stageNo })}
      closeButton
      onClose={onClose}
      renderButtonComponent={
        readOnly ? (
          <Button theme="secondary" onClick={onClose}>
            {tCommon('close')}
          </Button>
        ) : (
          <>
            <Button theme="secondary" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            {/* 선택을 비우면 BE 자동 분할로 되돌아간다 */}
            <Button theme="tertiary" onClick={() => onConfirm([])}>
              {t('resetToAutoAssign')}
            </Button>
            <Button onClick={() => onConfirm([...checkedIds])} disabled={checkedIds.size !== requiredCount}>
              {tCommon('confirm')}
            </Button>
          </>
        )
      }
    >
      <RobotPickerBody>
        <RobotPickerHead>
          <span className="selectedCount typographyBody5">
            {t('selectedRobotCount', { selected: checkedIds.size, required: requiredCount })}
          </span>
          <SearchContainer>
            <Search
              label={tCommon('search')}
              value={searchQuery}
              placeholder={tCommon('searchPlaceHolder')}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              onReset={() => setSearchQuery('')}
            />
          </SearchContainer>
        </RobotPickerHead>
        <Table
          data={visibleDevices}
          columns={columns}
          keyField="id"
          noData={tCommon('noData')}
          pagination
          paginationPerPage={perPage}
          paginationRowsPerPageOptions={[10, 30, 50, 100]}
          onChangePage={setCurrentPage}
          onChangeRowsPerPage={(newPerPage, page) => {
            setPerPage(newPerPage)
            setCurrentPage(page)
          }}
        />
      </RobotPickerBody>
    </Modal>
  )
}

export default RobotPickerModal
