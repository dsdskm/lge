import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { Modal, ModalButton, Calendar, Dropdown, Checkbox } from '@repo/ui'
import { AlertTriangle } from '@/assets/icon'

// ── Styled Components ──────────────────────────────────────────

const TargetDeviceBox = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 1.2rem 1.6rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-secondary-20);
  background-color: var(--color-secondary-5, #f8fafc);
  margin-bottom: 1.2rem;

  .label {
    color: var(--color-neutral-60);
    flex-shrink: 0;
  }
  .name {
    font-weight: 700;
    flex: 1;
  }
  .id {
    color: var(--color-neutral-50);
  }
`

const NoticeBox = styled.div`
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  padding: 1.2rem 1.4rem;
  border-radius: var(--radius-sm);
  background-color: #fef3c7;
  color: #92400e;
  margin-bottom: 1.6rem;

  svg {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    color: #d97706;
  }
`

const SectionLabel = styled.div`
  font-weight: 700;
  margin-bottom: 0.8rem;
`

const FieldGroup = styled.div`
  margin-bottom: 1.6rem;
`

const FieldSubLabel = styled.div`
  color: var(--color-neutral-60);
  margin-bottom: 0.6rem;
`

const FieldRow = styled.div`
  display: flex;
  gap: 0.8rem;

  & > * {
    min-width: 0;
  }
`

// ── Helper ─────────────────────────────────────────────────────

const hourOptions = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const minuteOptions = ['00', '30']
const durationOptions = ['20', '30', '60', '120', '180', '240']

const toDateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const roundDownToStep = (value, step) => Math.floor(value / step) * step

const buildDefaults = () => {
  const now = new Date()
  return {
    date: now,
    hour: String(now.getHours()).padStart(2, '0'),
    minute: String(roundDownToStep(now.getMinutes(), 30)).padStart(2, '0'),
    duration: '30',
    includeSystemTextLog: false
  }
}

// ── Component ──────────────────────────────────────────────────

/**
 * Props
 *  isOpen     : boolean
 *  onClose    : () => void
 *  onConfirm  : ({ deviceId, startDate, startHour, startMinute, duration, includeSystemTextLog }) => void
 *  deviceInfo : object — deviceInfo.name / deviceInfo.deviceId 사용
 *  t          : i18n translate fn
 */
const ModalLogUploadRequest = ({ isOpen, onClose, onConfirm, deviceInfo, t }) => {
  const [startDate, setStartDate] = useState(() => buildDefaults().date)
  const [startHour, setStartHour] = useState(() => buildDefaults().hour)
  const [startMinute, setStartMinute] = useState(() => buildDefaults().minute)
  const [duration, setDuration] = useState(() => buildDefaults().duration)
  const [includeSystemTextLog, setIncludeSystemTextLog] = useState(() => buildDefaults().includeSystemTextLog)

  // 최근 1일(오늘/어제)만 선택 가능
  const allowedDateKeys = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    return [toDateKey(yesterday), toDateKey(today)]
  }, [])

  useEffect(() => {
    if (isOpen) {
      const defaults = buildDefaults()
      setStartDate(defaults.date)
      setStartHour(defaults.hour)
      setStartMinute(defaults.minute)
      setDuration(defaults.duration)
      setIncludeSystemTextLog(defaults.includeSystemTextLog)
    }
  }, [isOpen])

  const handleClose = () => {
    onClose?.()
  }

  const handleConfirm = () => {
    onConfirm?.({
      deviceId: deviceInfo?.deviceId,
      startDate,
      startHour,
      startMinute,
      duration,
      includeSystemTextLog
    })
  }

  return (
    <Modal
      isOpen={isOpen}
      size="sm"
      title={t('logUploadRequest')}
      closeButton
      onClose={handleClose}
      renderButtonComponent={
        <div style={{ display: 'flex', gap: '0.75rem', width: '100%', justifyContent: 'flex-end' }}>
          <ModalButton variant="outlined" theme="default" onClick={handleClose}>
            {t('cancel')}
          </ModalButton>
          <ModalButton variant="contained" theme="primary" onClick={handleConfirm}>
            {t('uploadRequestConfirm')}
          </ModalButton>
        </div>
      }
    >
      <div style={{ padding: '4px 0' }}>
        <TargetDeviceBox>
          <span className="label typographyBody5">{t('targetDevice')}</span>
          <span className="name typographyBody4">{deviceInfo?.name}</span>
        </TargetDeviceBox>

        <NoticeBox className="typographyBody5">
          <AlertTriangle />
          <span>{t('logUploadNotice')}</span>
        </NoticeBox>

        <SectionLabel className="typographyBody4">{t('logTimeRange')}</SectionLabel>

        <FieldGroup>
          <FieldSubLabel className="typographyBody6">{t('start')}</FieldSubLabel>
          <FieldRow>
            <div style={{ flex: 1.4 }}>
              <Calendar
                type="date"
                startDate={startDate}
                onChangeStartDate={setStartDate}
                allowedDateKeys={allowedDateKeys}
              />
            </div>
            <Dropdown
              style={{ flex: 1 }}
              value={startHour}
              options={hourOptions.map((h) => ({ name: t('hourUnit', { n: h }), value: h }))}
              onChange={setStartHour}
            />
            <Dropdown
              style={{ flex: 1 }}
              value={startMinute}
              options={minuteOptions.map((m) => ({ name: t('minuteUnit', { n: m }), value: m }))}
              onChange={setStartMinute}
            />
          </FieldRow>
        </FieldGroup>

        <FieldGroup>
          <FieldSubLabel className="typographyBody6">{t('durationTime')}</FieldSubLabel>
          <Dropdown
            value={duration}
            options={durationOptions.map((d) => ({ name: t('minuteUnit', { n: d }), value: d }))}
            onChange={setDuration}
          />
        </FieldGroup>

        <FieldGroup style={{ marginBottom: 0 }}>
          <Checkbox
            label={t('includeSystemTextLog')}
            checked={includeSystemTextLog}
            onChange={(e) => setIncludeSystemTextLog(e.target.checked)}
          />
        </FieldGroup>
      </div>
    </Modal>
  )
}

export default ModalLogUploadRequest
