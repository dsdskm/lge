import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Section, Dropdown, Search, SearchContainer, HeaderTitleGroup, Button, NoData, Loading } from '@repo/ui'
import { ButtonWrap, StyledExpandedWrapper } from '@/components/common/styles'
import DevicesTableInExpand from './DevicesTableInExpand'
import { useTranslation } from 'react-i18next'
import { DEPLOYMENT_STATUS } from '@/constants/campaign'
import { campaignApis, mqttApis } from '@/apis'
import { useMqtt } from '@repo/hooks'

const ExpandOfCampaign = ({
  command,
  campaignRollbacks,
  data: campaignData,
  isClosing,
  inModal = false,
  handleAbort,
  handleRollback,
  onUpdateCampaign
}) => {
  const { t } = useTranslation('campaign')
  const { t: tCommon } = useTranslation('common')
  const brokerUrl = import.meta.env.VITE_MQTT_BROKER_URL
  const region = import.meta.env.VITE_AWS_REGION
  const { isConnected, subscribe } = useMqtt({ brokerUrl, region, fetchCredentials: mqttApis.getMqttCredentials })

  const [searchQuery, setSearchQuery] = useState('')
  const [filterQuery, setFilterQuery] = useState('all')
  const [filterCommandQuery, setFilterCommandQuery] = useState('all')
  const [selectedDevices, setSelectedDevices] = useState([])
  const [devices, setDevices] = useState(campaignData?.devices || [])
  const [mode, setMode] = useState('view')
  const [isLoading, setIsLoading] = useState(true)

  const devicesRef = useRef(devices)
  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  useEffect(() => {
    const baseDevices = campaignData.devices.map((device) => {
      const deviceCommand = command || (device.isRollback ? 'rollback' : 'update')
      return {
        ...device,
        command: deviceCommand,
        uniqueId: `${device.id}_${deviceCommand}`,
        campaignId: device.campaignId || campaignData.id
      }
    })

    const rollbackDevices =
      campaignRollbacks
        ?.flatMap((item) =>
          (item.TargetGroup?.Devices || []).map((device) => ({
            ...device,
            jobExecutionStatus: device.jobExecutionStatus || null,
            command: item.command,
            uniqueId: `${device.id}_${item.command}`,
            campaignId: item.id || campaignData.id
          }))
        )
        ?.filter((v, i, a) => a.findIndex((t) => t.uniqueId === v.uniqueId) === i) || []

    const combined = [...baseDevices, ...rollbackDevices].filter(
      (v, i, a) => a.findIndex((t) => t.uniqueId === v.uniqueId) === i
    )

    setDevices(combined.sort((a, b) => a.displayName - b.displayName))
  }, [campaignData, command, campaignRollbacks])

  useEffect(() => {
    const fetchDevicesByStatus = async () => {
      setIsLoading(true)
      try {
        const jobExecutionStatus = filterQuery === 'all' ? undefined : filterQuery
        const response = await campaignApis.retrieveCampaignDeviceList(campaignData.id, jobExecutionStatus)
        const deviceStatusList = response?.results || []
        const updatedDevices = deviceStatusList
          .map((device) => {
            const uniqueId = `${device.id}_${device.isRollback ? 'rollback' : 'update'}`
            const existingDevice = devicesRef.current.find((d) => d.uniqueId === uniqueId)
            return {
              ...device,
              command: device.isRollback ? 'rollback' : 'update',
              uniqueId,
              checked: false,
              campaignId: existingDevice?.campaignId || (device.isRollback ? device.campaignId : campaignData.id)
            }
          })
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
        setDevices(updatedDevices)
      } catch (error) {
        console.error('Failed to retrieve campaign device list:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDevicesByStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQuery])

  const filteredDevices = useMemo(() => {
    return devices.filter((item) => {
      const matchesStatus = filterQuery === 'all' || item.jobExecutionStatus === filterQuery
      const matchesCommand = filterCommandQuery === 'all' || item.command === filterCommandQuery
      const matchesSearch = (item.displayName || '').toLowerCase().includes(searchQuery.toLowerCase())
      return matchesStatus && matchesSearch && matchesCommand
    })
  }, [devices, filterQuery, searchQuery, filterCommandQuery])

  const statusOptions = [
    { value: 'all', name: t('all') },
    { value: DEPLOYMENT_STATUS.QUEUED, name: DEPLOYMENT_STATUS.QUEUED },
    { value: DEPLOYMENT_STATUS.IN_PROGRESS, name: DEPLOYMENT_STATUS.IN_PROGRESS },
    { value: DEPLOYMENT_STATUS.SUCCEEDED, name: DEPLOYMENT_STATUS.SUCCEEDED },
    { value: DEPLOYMENT_STATUS.FAILED, name: DEPLOYMENT_STATUS.FAILED },
    { value: DEPLOYMENT_STATUS.TIMED_OUT, name: DEPLOYMENT_STATUS.TIMED_OUT },
    { value: DEPLOYMENT_STATUS.REJECTED, name: DEPLOYMENT_STATUS.REJECTED },
    { value: DEPLOYMENT_STATUS.REMOVED, name: DEPLOYMENT_STATUS.REMOVED },
    { value: DEPLOYMENT_STATUS.CANCELED, name: DEPLOYMENT_STATUS.CANCELED }
  ]

  const commandOptions = [
    { value: 'all', name: t('all') },
    { value: 'update', name: 'Update' },
    { value: 'rollback', name: 'Rollback' }
  ]

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value)
  }

  const handleFilterChange = (value) => {
    setFilterQuery(value)
  }

  const handleFilterCommandChange = (value) => {
    setFilterCommandQuery(value)
  }

  const handleAbortClick = () => {
    handleAbort(selectedDevices)
    setSelectedDevices([])
    setMode('view')
  }

  const handleRollbackClick = () => {
    handleRollback(selectedDevices)
    setSelectedDevices([])
    setMode('view')
  }

  const handleCancelClick = () => {
    setSelectedDevices([])
    setMode('view')
  }

  useEffect(() => {
    if (devices?.length === 0) return
    const mode = (import.meta.env.VITE_MODE || 'qa').replace(/"/g, '')
    const deviceTopic = `${mode}/ota/device/status`

    const unsubscribe = subscribe(deviceTopic, (payload) => {
      try {
        if (payload.topic !== deviceTopic) {
          console.warn('mqtt subscribe artifact payload topic mismatch', payload.topic, deviceTopic)
          return
        }

        const deviceId = Number(payload.deviceId)
        const updatedDevices = devicesRef.current.map((d) => {
          if (d.id === deviceId && d.campaignId === Number(payload.campaignId)) {
            return { ...d, jobExecutionStatus: payload.status }
          }
          return d
        })

        setDevices(updatedDevices)

        if (onUpdateCampaign) {
          onUpdateCampaign(campaignData.id, {
            TargetGroup: {
              ...campaignData.TargetGroup,
              Devices: updatedDevices
            }
          })
        }
      } catch (err) {
        console.error('Error parsing MQTT device payload:', err)
      }
    })

    // Rollback 용 Topic
    const rollbackDeviceTopic = `${mode}/ota/device/rollback/status`

    const unsubscribeRollback = subscribe(rollbackDeviceTopic, (payload) => {
      try {
        if (payload.topic !== rollbackDeviceTopic) {
          console.warn('mqtt subscribe artifact payload rollback topic mismatch', payload.topic, rollbackDeviceTopic)
          return
        }

        const deviceId = Number(payload.deviceId)
        const updatedDevices = devicesRef.current.map((d) => {
          if (d.id === deviceId && d.campaignId === Number(payload.campaignId)) {
            return { ...d, jobExecutionStatus: payload.status }
          }
          return d
        })

        setDevices(updatedDevices)
      } catch (err) {
        console.error('Error parsing MQTT device payload:', err)
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
      if (unsubscribeRollback) unsubscribeRollback()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, subscribe, devices?.length > 0])

  return (
    <StyledExpandedWrapper $isClosing={isClosing} $inModal={inModal}>
      <Section>
        <HeaderTitleGroup>
          <Dropdown
            size="lg"
            label={t('status')}
            value={filterQuery}
            minWidth="180px"
            options={statusOptions}
            onChange={handleFilterChange}
            placeholder={t('all') || 'All'}
            style={{ marginBottom: '2rem' }}
          />
          <Dropdown
            size="lg"
            label={t('command')}
            value={filterCommandQuery}
            minWidth="180px"
            options={commandOptions}
            onChange={handleFilterCommandChange}
            placeholder={t('all') || 'All'}
            style={{ marginBottom: '2rem' }}
          />
          <SearchContainer>
            <Search value={searchQuery} onChange={handleSearchChange} placeholder={tCommon('searchPlaceHolder')} />
          </SearchContainer>
          <ButtonWrap className="alignRight" style={{ marginTop: '2rem' }}>
            {mode === 'view' && (
              <>
                <Button onClick={() => setMode('rollback')}>{t('rollback')}</Button>
                <Button onClick={() => setMode('abort')}>{t('abort')}</Button>
              </>
            )}
            {mode === 'abort' && (
              <Button onClick={handleAbortClick} disabled={selectedDevices.length === 0}>
                {t('abort')}
              </Button>
            )}
            {mode === 'rollback' && (
              <>
                <Button onClick={handleRollbackClick} disabled={selectedDevices.length === 0}>
                  {t('rollback')}
                </Button>
              </>
            )}

            {mode !== 'view' && <Button onClick={handleCancelClick}>{t('cancel')}</Button>}
          </ButtonWrap>
        </HeaderTitleGroup>
        {isLoading ? (
          <Loading />
        ) : filteredDevices.length === 0 ? (
          <Section>
            <NoData>{t('noAvailableDevices')}</NoData>
          </Section>
        ) : (
          <DevicesTableInExpand
            data={filteredDevices}
            statusOption={filterQuery}
            onSelectionChange={setSelectedDevices}
            mode={mode}
          />
        )}
      </Section>
    </StyledExpandedWrapper>
  )
}

export default ExpandOfCampaign
