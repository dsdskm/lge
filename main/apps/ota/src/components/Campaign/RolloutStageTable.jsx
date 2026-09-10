import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dropdown, IconButton, Input, StyledTag, UITooltip } from '@repo/ui'
import { ALLOCATION_TYPE, MAX_STAGE_COUNT } from '@/constants/campaign'
import { createDefaultStage, divideStageCounts } from '@/utils/rolloutStage'
import InfoTooltipIcon from '@/components/common/InfoTooltipIcon'
import { PauseOption, StageNotice, StageTable, StageTableFooter } from './styles'

const TOOLTIP_ID = 'rollout-stage-tooltip'

/**
 * Rollout Stage(캠페인 그룹 단계) 입력 표.
 * 단계별로 배포 대상 비율/대수, 다음 단계 진행 기준(최소 성공률), 관찰 시간을 지정한다.
 * BE 대응: Campaign.allocationType / allocationValue / successThreshold / waitMinutes
 *
 * @param stages   [{ allocationType, allocationValue, successThreshold, observationHours, deviceCount }]
 * @param total    분할 대상 총 대수 (Added Robots 프리뷰 계산용)
 * @param errors   validateStages가 만든 단계별 필드 에러 [{ allocationValue: true, ... }]
 */
const RolloutStageTable = ({
  stages,
  onChange,
  total = 0,
  pauseAfterEachStage,
  onPauseChange,
  disabled = false,
  errors = [],
  onOpenRobotPicker,
  robotPickerEnabled = false
}) => {
  const { t } = useTranslation('campaign')

  const allocationTypeOptions = useMemo(
    () => [
      { name: t('robots'), value: ALLOCATION_TYPE.COUNT },
      { name: '%', value: ALLOCATION_TYPE.PERCENT }
    ],
    [t]
  )

  // 저장된 단계(deviceCount)는 BE가 실제 배정한 대수를, 편집 중인 단계는 프리뷰 계산값을 보여준다.
  const previewCounts = useMemo(() => divideStageCounts(total, stages), [total, stages])

  // 마지막 단계가 100% 미만이면 어떤 단계에도 배정되지 않는 로봇이 남는다
  const unassignedCount = useMemo(
    () => Math.max(total - previewCounts.reduce((sum, count) => sum + count, 0), 0),
    [total, previewCounts]
  )

  const updateStage = (index, patch) => {
    onChange(stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)))
  }

  const handleAddStage = () => {
    onChange([...stages, createDefaultStage(stages.length)])
  }

  const handleRemoveStage = (index) => {
    onChange(stages.filter((_, i) => i !== index))
  }

  return (
    <>
      <StageTable>
        <colgroup>
          <col className="colStage" />
          <col />
          <col className="colAddedRobots" />
          <col />
          <col />
          <col className="colRemove" />
        </colgroup>
        <thead>
          <tr>
            <th>{t('stage')}</th>
            <th>{t('target')}</th>
            <th>
              {t('addedRobots')}
              <InfoTooltipIcon
                tooltipId={TOOLTIP_ID}
                title={t('addedRobots')}
                desc={t('addedRobotsNotice')}
              />
            </th>
            <th>
              {t('minSuccessRate')}
              <InfoTooltipIcon
                tooltipId={TOOLTIP_ID}
                title={t('minSuccessRate')}
                desc={t('minSuccessRateNotice')}
              />
            </th>
            <th>
              {t('minObservationTime')}
              <InfoTooltipIcon
                tooltipId={TOOLTIP_ID}
                title={t('minObservationTime')}
                desc={t('minObservationTimeNotice')}
              />
            </th>
            <th aria-label={t('delete')} />
          </tr>
        </thead>
        <tbody>
          {stages.map((stage, index) => {
            const isLast = index === stages.length - 1
            const stageError = errors[index] || {}
            const selectedCount = stage.deviceIds?.length || 0
            // 직접 선택한 단계는 선택 수, 저장된 단계는 BE 배정 수, 편집 중이면 프리뷰 계산값
            const addedRobots = selectedCount || stage.deviceCount || previewCounts[index]
            const addedRobotsLabel = Number.isFinite(addedRobots) ? t('robotsCount', { count: addedRobots }) : '-'

            return (
              <tr key={index}>
                <td className="stageNo">{index + 1}</td>
                <td>
                  <div className="targetCell">
                    <Input
                      size="lg"
                      type="number"
                      min={0}
                      value={stage.allocationValue}
                      isError={!!stageError.allocationValue}
                      disabled={disabled}
                      onChange={(e) => updateStage(index, { allocationValue: e.target.value })}
                    />
                    <Dropdown
                      size="lg"
                      value={stage.allocationType}
                      options={allocationTypeOptions}
                      disabled={disabled}
                      onChange={(value) => updateStage(index, { allocationType: value })}
                    />
                  </div>
                </td>
                <td className="addedRobots">
                  {robotPickerEnabled ? (
                    <Button
                      theme="link"
                      disabled={!addedRobots}
                      onClick={() => onOpenRobotPicker(index)}
                      data-tooltip-id={TOOLTIP_ID}
                      data-tooltip-desc={t('selectStageRobotsNotice')}
                    >
                      {addedRobotsLabel}
                    </Button>
                  ) : (
                    addedRobotsLabel
                  )}
                  {stage.manualSelection && <span className="manualMark typographyBody6">{t('manuallySelected')}</span>}
                </td>
                <td>
                  <Input
                    size="lg"
                    type="number"
                    min={0}
                    max={100}
                    unit="%"
                    value={stage.successThreshold}
                    isError={!!stageError.successThreshold}
                    disabled={disabled}
                    onChange={(e) => updateStage(index, { successThreshold: e.target.value })}
                  />
                </td>
                <td>
                  <Input
                    size="lg"
                    type="number"
                    min={0}
                    unit="h"
                    value={isLast ? '' : stage.observationHours}
                    isError={!!stageError.observationHours}
                    // 마지막 단계는 다음 단계가 없어 관찰 시간이 사용되지 않는다
                    disabled={disabled || isLast}
                    onChange={(e) => updateStage(index, { observationHours: e.target.value })}
                  />
                </td>
                <td className="colRemove">
                  <IconButton
                    name="delete"
                    size="sm"
                    theme="icon-only"
                    aria-label={t('delete')}
                    disabled={disabled || stages.length <= 1}
                    onClick={() => handleRemoveStage(index)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </StageTable>
      <StageTableFooter>
        <Button theme="tertiary" disabled={disabled || stages.length >= MAX_STAGE_COUNT} onClick={handleAddStage}>
          {`+ ${t('add')}`}
        </Button>
      </StageTableFooter>
      {!disabled && unassignedCount > 0 && (
        <StageNotice className="typographyBody6">
          <InfoTooltipIcon
            tooltipId={TOOLTIP_ID}
            title={t('unassignedRobots')}
            desc={t('unassignedRobotsTooltip')}
          />
          {t('unassignedRobotsNotice', { count: unassignedCount })}
        </StageNotice>
      )}
      <PauseOption>
        <div className="optionHead">
          <Checkbox
            label={t('pauseAfterEachStage')}
            checked={pauseAfterEachStage}
            disabled={disabled}
            onChange={(e) => onPauseChange(e.target.checked)}
          />
          <StyledTag color="var(--color-primary-80)" bgColor="var(--color-primary-20)">
            {t('recommended')}
          </StyledTag>
        </div>
        <span className="optionDesc typographyBody6">{t('pauseAfterEachStageDesc')}</span>
      </PauseOption>
      <UITooltip id={TOOLTIP_ID} />
    </>
  )
}

export default RolloutStageTable
