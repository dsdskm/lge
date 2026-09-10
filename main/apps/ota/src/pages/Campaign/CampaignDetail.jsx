import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  StyledPageContent,
  Section,
  SectionTitle,
  HeaderTitleGroup,
  Dropdown,
  Search,
  SearchContainer,
  Button,
  Radio,
  Title,
  Input,
  Textarea,
  Modal,
  Icon,
  StyledTag,
  ToggleSwitch,
  Calendar,
  UITooltip
} from '@repo/ui'
import { useTranslation } from 'react-i18next'
import ArtifactTable from '@/components/Artifact/ArtifactTable'
import RolloutStageTable from '@/components/Campaign/RolloutStageTable'
import RobotPickerModal from '@/components/Campaign/RobotPickerModal'
import {
  actionApis,
  campaignApis,
  campaignGroupApis,
  targetGroupApis,
  policyApis,
  moduleApis,
  packageTypeApis
} from '@/apis'
import { artifactApis } from '@repo/apis'
import { toast } from 'react-toastify'
import { convertDateToString } from '@repo/utils'
import { useOrganizationStore, useUserStore } from '@repo/stores'
import {
  ArtifactPickerBody,
  DetailCardRow,
  FieldGroup,
  InfoList,
  PickerField,
  ScheduleFieldRow,
  SectionNotice,
  TitleWithHelp
} from './styles'
import InfoTooltipIcon from '@/components/common/InfoTooltipIcon'
import { ButtonWrap, DetailHead } from '@/components/common/styles'
import { ClipLoader } from 'react-spinners'
import { ARTIFACT_STATUS } from '@/constants/artifact'
import { CAMPAIGN_GROUP_STATUS, COMPLETED_PHASE_STATUS, DEPLOYMENT_STATUS } from '@/constants/campaign'
import { statusToColor, statusToBgColor } from '@/utils/common'
import {
  createDefaultStage,
  divideStageCounts,
  toPhasePayload,
  toStageState,
  validateStages
} from '@/utils/rolloutStage'

const COMPLETED_DEPLOYMENT_STATUS = [
  DEPLOYMENT_STATUS.SUCCEEDED,
  DEPLOYMENT_STATUS.FAILED,
  DEPLOYMENT_STATUS.REJECTED,
  DEPLOYMENT_STATUS.TIMED_OUT,
  DEPLOYMENT_STATUS.CANCELED,
  DEPLOYMENT_STATUS.REMOVED
]

const FAILED_DEPLOYMENT_STATUS = [DEPLOYMENT_STATUS.FAILED, DEPLOYMENT_STATUS.REJECTED, DEPLOYMENT_STATUS.TIMED_OUT]

const TOOLTIP_ID = 'campaign-detail-tooltip'

const formatDate = (value) => (value ? convertDateToString(value) : '-')

const sortByName = (options) => [...options].sort((a, b) => String(a.name).localeCompare(String(b.name)))

const CampaignDetail = () => {
  const { id } = useParams()
  const { t } = useTranslation('campaign')
  const { t: tCommon } = useTranslation('common')
  const session = useUserStore((state) => state.session)
  const userId = session?.email
  const userRole = session?.userRole
  const { allOrgs, actualOrgs, company, defaultOrg } = useOrganizationStore()

  const searchParams = new URLSearchParams(window.location.search)
  const orgIdParam = searchParams.get('orgId')
  // 캠페인 그룹은 캠페인과 별개 엔티티이므로 ?type=group 으로 구분해 조회한다
  const isGroupDetail = searchParams.get('type') === 'group'
  const currentOrg = useMemo(() => allOrgs.concat(defaultOrg).find((o) => o.id === Number(orgIdParam)), [defaultOrg])

  const navigate = useNavigate()

  const [processedArtifactData, setProcessedArtifactData] = useState([])
  const handleRowClick = (row) => {
    setPendingArtifactId(row.id)
  }
  const [searchQuery, setSearchQuery] = useState('')
  const [targetGroupOptions, setTargetGroupOptions] = useState([])
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState('')
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [selectedPostActionId, setSelectedPostActionId] = useState('')
  const [selectedPreActionId, setSelectedPreActionId] = useState('')
  const [selectedArtifactId, setSelectedArtifactId] = useState('')
  const [selectedPackageTypeId, setSelectedPackageTypeId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [memo, setMemo] = useState('')
  const [policyOptions, setPolicyOptions] = useState([])
  const [actionOptions, setActionOptions] = useState([])
  const [moduleOptions, setModuleOptions] = useState([])
  const [packageTypeOptions, setPackageTypeOptions] = useState([])
  const [organizationOptions, setOrganizationOptions] = useState([])
  const [selectedModuleId, setSelectedModuleId] = useState('')
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDeploying, setIsDeploying] = useState(false)
  const [allModules, setAllModules] = useState([])
  const [jobStatus, setJobStatus] = useState(null)
  const [campaign, setCampaign] = useState(null)
  const [isArtifactModalOpen, setIsArtifactModalOpen] = useState(false)
  const [pendingArtifactId, setPendingArtifactId] = useState('')
  // Rollout Stage(단계적 배포) : ON이면 캠페인 그룹으로 생성한다
  const [rolloutStageEnabled, setRolloutStageEnabled] = useState(false)
  const [stages, setStages] = useState([createDefaultStage()])
  const [pauseAfterEachStage, setPauseAfterEachStage] = useState(true)
  const [stageErrors, setStageErrors] = useState([])
  const [campaignGroup, setCampaignGroup] = useState(null)
  // Rollout Schedule : 현재는 화면 입력만 지원하며 저장/배포 요청에는 포함하지 않는다
  const [robotPickerStageIndex, setRobotPickerStageIndex] = useState(null)
  const [rolloutScheduleEnabled, setRolloutScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(null)
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleTimezone, setScheduleTimezone] = useState('Asia/Seoul')

  const timezoneOptions = useMemo(
    () => [
      { name: 'UTC +09:00 (Seoul)', value: 'Asia/Seoul' },
      { name: 'UTC +09:00 (Tokyo)', value: 'Asia/Tokyo' },
      { name: 'UTC +00:00 (UTC)', value: 'UTC' },
      { name: 'UTC -08:00 (Los Angeles)', value: 'America/Los_Angeles' }
    ],
    []
  )

  const tableHeader = () => {
    return {
      columns: [
        {
          name: '',
          cell: (row) => (
            <Radio
              checked={Number(row.id) === Number(pendingArtifactId)}
              onChange={() => handleRowClick(row)}
              disabled={id}
            />
          ),
          width: '50px'
        },
        {
          name: t('title'),
          selector: (row) => (
            <Button as={'NavLink'} to={`/ota/artifact/detail/${row.id}`} theme={'link'}>
              {row.displayName}
            </Button>
          ),
          sortable: 'true'
        },
        {
          name: t('module'),
          selector: (row) => row.Module.displayName,
          sortable: 'true'
        },
        {
          name: t('packageType'),
          selector: (row) => allModules.find((item) => item.code === row.Module.code)?.PackageType?.displayName,
          sortable: 'true'
        },
        {
          name: t('organization'),
          selector: (row) => row.Organization.displayName,
          sortable: 'true'
        },
        {
          name: t('date'),
          selector: (row) => row.createdAt,
          sortable: 'true'
        }
      ]
    }
  }

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value)
  }

  const handleResetSearch = () => {
    setSearchQuery('')
  }

  const handleModuleChange = (value) => {
    setSelectedModuleId(value)
  }

  const handlePackageTypeChange = (value) => {
    setSelectedPackageTypeId(value)
    setModuleOptions(
      sortByName(
        allModules
          .filter((module) => module.PackageType.id === Number(value))
          .map((item) => ({
            name: item.displayName,
            value: item.id
          }))
      )
    )
  }

  const handleOrganizationChange = (value) => {
    setSelectedOrganizationId(value)
  }

  const handleGroupChange = (value) => {
    setSelectedTargetGroupId(value)
    // 로봇 풀이 바뀌면 단계별 직접 선택은 무효가 되므로 자동 배정으로 되돌린다
    setStages((prev) => prev.map((stage) => ({ ...stage, deviceIds: [], manualSelection: false })))
  }

  const handlePostActionChange = (value) => {
    setSelectedPostActionId(value)
  }

  const handlePreActionChange = (value) => {
    setSelectedPreActionId(value)
  }

  const handlePolicyChange = (value) => {
    setSelectedPolicyId(value)
  }

  const filteredArtifactData = processedArtifactData
    .filter((item) => {
      const matchesSearch = item.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesOrg =
        !selectedOrganizationId ||
        selectedOrganizationId === 'all' ||
        Number(item.Organization.id) === Number(selectedOrganizationId)
      const matchesModule =
        !selectedModuleId || selectedModuleId === 'all' || Number(item.Module?.id) === Number(selectedModuleId)
      const completed = item.status === ARTIFACT_STATUS.SUCCESS
      const matchesPackageType = item.Module.packageTypeId === Number(selectedPackageTypeId)

      return matchesSearch && matchesOrg && matchesModule && completed && matchesPackageType
    })
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)))

  const selectedTargetGroup = targetGroupOptions.find(
    (option) => Number(option.value) === Number(selectedTargetGroupId)
  )?.origin

  const selectedArtifact =
    processedArtifactData.find((item) => Number(item.id) === Number(selectedArtifactId)) || campaign?.Artifact

  const artifactVersion = selectedArtifact?.Versions?.map((version) => version.displayName).join(', ') || '-'

  // 롤아웃 진행 상황 : 캠페인 응답에 디바이스 목록이 있으면 그 기준, 없으면 타겟 그룹 대수만 노출
  const deployedDevices = campaign?.TargetGroup?.Devices || []
  const totalUnits = deployedDevices.length || selectedTargetGroup?.deviceCount || 0
  const completedUnits = deployedDevices.filter((device) =>
    COMPLETED_DEPLOYMENT_STATUS.includes(device.jobExecutionStatus)
  ).length
  const failedUnits = deployedDevices.filter((device) =>
    FAILED_DEPLOYMENT_STATUS.includes(device.jobExecutionStatus)
  ).length

  // 캠페인 그룹은 Step을 "완료된 단계 수 / 전체 단계 수"로, 상태를 그룹 status로 표시한다
  const groupPhases = campaignGroup?.Campaigns || []
  const completedPhaseCount = groupPhases.filter((phase) => COMPLETED_PHASE_STATUS.includes(phase.phaseStatus)).length
  const currentStep = isGroupDetail ? completedPhaseCount : (campaign?.currentStep ?? 0)
  const totalStep = isGroupDetail ? groupPhases.length : campaign?.totalStep
  const displayStatus = isGroupDetail ? campaignGroup?.status : jobStatus

  // 단계 분할 대상 로봇 풀 : BE도 ACTIVE 로봇만 분할하므로 화면도 동일하게 맞춘다.
  // static 그룹만 고정 device 목록을 내려주므로 직접 선택은 static에서만 지원한다.
  const isStaticTargetGroup = selectedTargetGroup?.mode === 'static'
  const devicePool = useMemo(
    () => (selectedTargetGroup?.Devices || []).filter((device) => device.deviceRegStatus === 'ACTIVE'),
    [selectedTargetGroup]
  )
  const stagePoolUnits = isStaticTargetGroup ? devicePool.length : (selectedTargetGroup?.deviceCount ?? 0)
  // 전체 대수 - 배포 가능 대수 = 비ACTIVE(REGISTERED/SUSPENDED/REVOKED/미동기화)로 제외되는 대수
  const excludedUnits = isStaticTargetGroup
    ? Math.max((selectedTargetGroup?.deviceCount ?? devicePool.length) - devicePool.length, 0)
    : 0
  const canPickRobots = isStaticTargetGroup && devicePool.length > 0

  // 배정 로봇 선택 모달 : 다른 단계에 이미 배정된 로봇은 선택 대상에서 제외한다
  const pickerStage = robotPickerStageIndex === null ? null : stages[robotPickerStageIndex]
  const pickerRequiredCount = useMemo(() => {
    if (robotPickerStageIndex === null) return 0
    return pickerStage?.deviceCount ?? divideStageCounts(stagePoolUnits, stages)[robotPickerStageIndex] ?? 0
  }, [robotPickerStageIndex, pickerStage, stagePoolUnits, stages])
  const pickerExcludedIds = useMemo(
    () => stages.flatMap((stage, index) => (index === robotPickerStageIndex ? [] : stage.deviceIds || [])),
    [stages, robotPickerStageIndex]
  )
  // 저장된 그룹은 조회 전용이며, phase에 배정된 로봇만 모달에 표시한다
  const pickerDevices = isGroupDetail ? pickerStage?.devices || [] : devicePool

  const handleOpenRobotPicker = (stageIndex) => {
    setRobotPickerStageIndex(stageIndex)
  }

  const handleConfirmRobotPicker = (deviceIds) => {
    setStages((prev) =>
      prev.map((stage, index) =>
        index === robotPickerStageIndex ? { ...stage, deviceIds, manualSelection: deviceIds.length > 0 } : stage
      )
    )
    setRobotPickerStageIndex(null)
  }
  // 그룹의 시작/완료 시각은 첫 단계의 배포 시각과 마지막 단계의 완료 시각으로 본다
  const startedAt = isGroupDetail ? groupPhases[0]?.requestAt : campaign?.requestAt
  const completedAt = isGroupDetail ? groupPhases[groupPhases.length - 1]?.completeAt : campaign?.completeAt
  const lastUpdatedAt = isGroupDetail ? campaignGroup?.updatedAt : campaign?.updatedAt

  const handleOpenArtifactModal = () => {
    if (id) return
    setPendingArtifactId(selectedArtifactId)
    setIsArtifactModalOpen(true)
  }

  const handleCloseArtifactModal = () => {
    setIsArtifactModalOpen(false)
  }

  const handleConfirmArtifact = () => {
    setSelectedArtifactId(pendingArtifactId)
    setIsArtifactModalOpen(false)
  }

  // 단계 입력값 사전 검증 (BE saveCampaignGroup과 동일 규칙). 통과 못하면 저장을 중단한다.
  const validateRolloutStages = () => {
    const { errors, messages } = validateStages(stages, stagePoolUnits, t)
    setStageErrors(errors)
    if (messages.length > 0) {
      toast.error(messages[0], { autoClose: 4000 })
      return false
    }
    return true
  }

  // Rollout Stage ON → 캠페인 그룹 생성 (그룹 1개 + 단계별 phase 캠페인)
  const saveCampaignGroup = async () => {
    const payload = {
      displayName, // Mandatory
      userId, // Mandatory
      memo, // Optional
      orgId: currentOrg.id, // Mandatory
      targetGroupId: selectedTargetGroupId || undefined, // Mandatory
      policyId: selectedPolicyId || undefined, // Mandatory
      artifactId: selectedArtifactId, // Mandatory
      preActionId: selectedPreActionId || undefined, // Optional
      postActionId: selectedPostActionId || undefined, // Optional
      mode: pauseAfterEachStage ? 'manual' : 'auto', // 단계마다 사용자 확인 대기 여부
      phases: toPhasePayload(stages)
    }
    const saveResponse = await campaignGroupApis.saveCampaignGroup(payload)
    const result = saveResponse.results

    // 비ACTIVE 상태로 분할 대상에서 제외된 device가 있으면 운영자에게 알린다
    const excludedCount = result?.excludedDevices?.length || 0
    if (excludedCount > 0) {
      toast.warn(t('excludedDeviceNotice', { count: excludedCount }), { autoClose: 4000 })
    }
    return result?.campaignGroupId
  }

  const handleSave = async (isRequest = false) => {
    try {
      if (rolloutStageEnabled) {
        if (!validateRolloutStages()) return
        const campaignGroupId = await saveCampaignGroup()
        if (isRequest) return campaignGroupId
        navigate('/ota/campaign')
        toast.success(tCommon('success'), { autoClose: 2000 })
        return
      }

      const payload = {
        ...(id && { id: Number(id) }),
        displayName, // Mandatory
        userId, // Mandatory
        memo, // Optional
        orgId: currentOrg.id, // Mandatory
        targetGroupId: selectedTargetGroupId || undefined, // Mandatory
        policyId: selectedPolicyId || undefined, // Mandatory
        artifactId: selectedArtifactId, // Mandatory
        preActionId: selectedPreActionId || undefined, // Optional
        postActionId: selectedPostActionId || undefined // Optional
      }
      const saveResponse = await campaignApis.saveCampaign(payload)
      console.log('saveResponse', saveResponse)
      if (isRequest) {
        return saveResponse.results[0].id
      }
      navigate('/ota/campaign')
      toast.success(tCommon('success'), { autoClose: 2000 })
    } catch (error) {
      console.error(error)
      toast.error(tCommon('error.description'), { autoClose: 2000 })
    }
  }

  const handleRequest = async () => {
    try {
      // 이미 저장된 캠페인 그룹(DRAFT)은 재생성 없이 배포만 요청한다
      if (isGroupDetail) {
        setIsDeploying(true)
        await campaignGroupApis.requestCampaignGroup({ id: Number(id), userId })
        navigate('/ota/campaign')
        toast.success(tCommon('success'), { autoClose: 2000 })
        return
      }

      // 단계 검증 실패는 여기서 중단한다(검증 메시지 위에 일반 오류 토스트가 겹치지 않도록)
      if (rolloutStageEnabled && !validateRolloutStages()) return

      const savedId = await handleSave(true)

      if (!savedId) {
        toast.error(tCommon('error.description'), { autoClose: 2000 })
        return
      }

      setIsDeploying(true)
      // 캠페인 그룹은 첫 단계만 배포되고 이후 단계는 BE가 성공률/모드에 따라 진행한다
      if (rolloutStageEnabled) {
        await campaignGroupApis.requestCampaignGroup({ id: savedId, userId })
      } else {
        await campaignApis.requestCampaign({ id: savedId, userId })
      }
      navigate('/ota/campaign')
      toast.success(tCommon('success'), { autoClose: 2000 })
    } catch (error) {
      console.error(error)
      toast.error(tCommon('error.description'), { autoClose: 2000 })
    } finally {
      setIsDeploying(false)
    }
  }

  const handleCancel = () => {
    console.log('cancel')
    navigate('/ota/campaign')
  }

  // 캠페인 그룹은 DRAFT 상태에서만 배포를 시작할 수 있고, 수정 API가 없어 재저장은 지원하지 않는다
  const isGroupStarted = !!campaignGroup && campaignGroup.status !== CAMPAIGN_GROUP_STATUS.DRAFT

  const isDeployDisabled = () => {
    if (isGroupDetail) return isGroupStarted
    // 캠페인 그룹 생성은 policyId가 필수값이다
    if (rolloutStageEnabled && !selectedPolicyId) return true
    return !displayName || !selectedTargetGroupId || !selectedArtifactId || jobStatus
  }

  const isSaveDisabled = () => {
    if (isGroupDetail) return true
    if (rolloutStageEnabled) {
      return !displayName || !selectedTargetGroupId || !selectedArtifactId || !selectedPolicyId
    }
    return !displayName
  }

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        // defaultOrg 초기값이 {} 이므로 id 없는 조직(미로딩)은 제외한다
        const actualOrgIds = (userRole === 'SYSTEM_MANAGER' ? [...allOrgs, defaultOrg] : actualOrgs)
          .map((org) => org?.id)
          .filter((orgId) => orgId !== undefined && orgId !== null)

        if (actualOrgIds.length === 0) {
          setIsLoading(false)
          return
        }

        const [packageTypeRes, groupRes, policyRes, actionRes, artifactRes, moduleRes] = await Promise.all([
          packageTypeApis.retrievePackageTypes(company.id),
          targetGroupApis.retrieveTargetGroup(actualOrgIds),
          policyApis.retrievePolicy(actualOrgIds),
          actionApis.retrieveAction(actualOrgIds),
          artifactApis.retrieveArtifacts(actualOrgIds),
          moduleApis.retrieveModules(company.id)
        ])

        const ptOptions = packageTypeRes.results.map((item) => ({
          name: item.displayName,
          value: item.id,
          origin: item
        }))
        setPackageTypeOptions(ptOptions)

        const groupOptions = sortByName(
          groupRes.results
            .filter((item) => item.campaignType === 'update')
            .map((item) => ({
              name: item.displayName,
              value: item.id,
              origin: item
            }))
        )
        setTargetGroupOptions(groupOptions)

        const policyOptionsFetched = policyRes.results.map((item) => ({
          name: item.displayName,
          value: item.id,
          origin: item
        }))
        setPolicyOptions(policyOptionsFetched)

        const actionOptionsFetched = actionRes.results.map((item) => ({
          name: item.displayName,
          value: item.id,
          origin: item
        }))
        setActionOptions(actionOptionsFetched)

        setProcessedArtifactData(
          artifactRes.results.map((item) => ({
            ...item,
            module: item.Module.displayName,
            packageType: item.PackageType?.displayName,
            organization: item.Organization.displayName,
            createdAt: item.createdAt ? convertDateToString(item.createdAt) : '-'
          }))
        )

        setAllModules(moduleRes.results)

        const mOptions = sortByName(
          moduleRes.results.map((item) => ({
            name: item.displayName,
            value: item.id
          }))
        )
        setModuleOptions(mOptions.length > 0 ? [{ name: t('all'), value: 'all' }, ...mOptions] : [])

        setOrganizationOptions([
          { name: t('all'), value: 'all' },
          ...sortByName(
            allOrgs.map((item) => ({
              name: item.displayName,
              value: item.id
            }))
          )
        ])

        if (id && isGroupDetail) {
          // 캠페인 그룹 상세 : 그룹 + phase(단계) 목록을 화면 상태로 복원
          const groupResponse = await campaignGroupApis.retrieveCampaignGroup(id, orgIdParam)
          const group = groupResponse.results?.[0]
          if (group) {
            const phases = group.Campaigns || []
            setCampaignGroup(group)
            setDisplayName(group.displayName)
            setMemo(group.memo || '')
            setSelectedTargetGroupId(group.TargetGroup?.id)
            setSelectedOrganizationId(group.Organization?.id)
            setSelectedArtifactId(phases[0]?.artifactId)
            setPendingArtifactId(phases[0]?.artifactId)
            setSelectedPolicyId(phases[0]?.policyId)
            setRolloutStageEnabled(true)
            setStages(phases.length > 0 ? toStageState(phases) : [createDefaultStage()])
            setPauseAfterEachStage(group.mode === 'manual')
          }
        } else if (id) {
          const campaignResponse = await campaignApis.retrieveCampaign([Number(orgIdParam)], id)
          const campaign = campaignResponse.results.pageCampaign[0]
          if (campaign) {
            setCampaign(campaign)
            setDisplayName(campaign.displayName)
            setMemo(campaign.memo)
            setSelectedTargetGroupId(campaign.TargetGroup?.id)
            setSelectedPostActionId(campaign.postAction?.id)
            setSelectedPreActionId(campaign.preAction?.id)
            setSelectedPolicyId(campaign.Policy?.id)
            setSelectedModuleId(campaign.Module?.id)
            setSelectedOrganizationId(campaign.Organization?.id)
            setSelectedArtifactId(campaign.Artifact?.id)
            setPendingArtifactId(campaign.Artifact?.id)
            setJobStatus(campaign.jobStatus)
          }
        }
        setIsLoading(false)
      } catch (error) {
        console.error('Failed to fetch data:', error)
      }
    }

    fetchData()
  }, [id, actualOrgs, allOrgs])

  return (
    <StyledPageContent className="column">
      <DetailHead>
        <div className="titleGroup">
          <Title>{id ? t('campaignDetail') : t('campaignCreation')}</Title>
          <span className="orgName typographyBody5">{`${tCommon('organizationName')} : ${currentOrg?.displayName || ''}`}</span>
        </div>
        <ButtonWrap className="alignRight">
          <Button onClick={() => handleRequest()} disabled={isDeployDisabled()}>
            {t('request')}
          </Button>
          <Button onClick={() => handleSave(false)} disabled={isSaveDisabled()}>
            {t('save')}
          </Button>
          <Button onClick={() => handleCancel()}>{t('cancel')}</Button>
        </ButtonWrap>
      </DetailHead>
      <DetailCardRow $columns="minmax(0, 2fr) minmax(0, 1fr)">
        <Section gap="1.6rem">
          <SectionTitle title={t('campaignDetails')} />
          <Input
            label={t('campaignName')}
            size="lg"
            placeholder={t('enterTitle')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Textarea
            label={t('description')}
            size="lg"
            placeholder={t('enterDescription')}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            count={`${memo.length}/100`}
            maxLength={100}
          />
        </Section>
        <Section>
          <SectionTitle title={t('updateStatus')} />
          <InfoList>
            <dt>{t('status')}</dt>
            <dd>
              <StyledTag color={statusToColor(displayStatus)} bgColor={statusToBgColor(displayStatus)}>
                {displayStatus || t('notDeployed')}
              </StyledTag>
            </dd>
            <dt>{t('step')}</dt>
            <dd>{totalStep ? `${currentStep} / ${totalStep}` : '-'}</dd>
            <dt>{t('rolloutProgress')}</dt>
            <dd>
              {`${completedUnits} / ${totalUnits}`}
              <span className="failedCount">{`· ${failedUnits} ${t('failed')}`}</span>
            </dd>
            {/* <dt>{t('rolloutVersion')}</dt>
            <dd>{artifactVersion}</dd> */}
            <dt>{t('startedAt')}</dt>
            <dd>{formatDate(startedAt)}</dd>
            <dt>{t('lastUpdated')}</dt>
            <dd>{formatDate(lastUpdatedAt)}</dd>
            <dt>{t('completedAt')}</dt>
            <dd>{formatDate(completedAt)}</dd>
          </InfoList>
        </Section>
      </DetailCardRow>
      <DetailCardRow $columns="repeat(3, minmax(0, 1fr))">
        <Section gap="1.6rem">
          <SectionTitle title={t('targetGroup')} />
          <Dropdown
            label={t('name')}
            size="lg"
            value={selectedTargetGroupId}
            placeholder={t('selectTargetGroup')}
            options={targetGroupOptions}
            showSearch={true}
            disabled={id}
            onChange={handleGroupChange}
          />
          <InfoList>
            <dt>{t('units')}</dt>
            <dd>{selectedTargetGroup?.deviceCount ?? '-'}</dd>
            {/* 배포는 DM 등록 상태가 ACTIVE인 로봇만 대상이라 전체 대수와 따로 보여준다 */}
            <dt>
              {t('deployableUnits')}
              <InfoTooltipIcon
                tooltipId={TOOLTIP_ID}
                title={t('deployableUnits')}
                desc={t('deployableUnitsNotice')}
              />
            </dt>
            <dd>
              {isStaticTargetGroup ? (
                <>
                  {devicePool.length}
                  {excludedUnits > 0 && (
                    <span className="failedCount">{t('excludedUnits', { count: excludedUnits })}</span>
                  )}
                </>
              ) : (
                t('notAvailable')
              )}
            </dd>
            <dt>{t('mode')}</dt>
            <dd>{selectedTargetGroup?.mode ? t(selectedTargetGroup.mode) : '-'}</dd>
            <dt>{t('lastUpdated')}</dt>
            <dd>{formatDate(selectedTargetGroup?.updatedAt)}</dd>
          </InfoList>
        </Section>
        <Section gap="1.6rem">
          <SectionTitle title={t('artifact')} />
          <PickerField $disabled={!!id} onClick={handleOpenArtifactModal}>
            <Input
              label={t('name')}
              size="lg"
              readOnly
              placeholder={t('selectArtifact')}
              value={selectedArtifact?.displayName || ''}
              disabled={!!id}
              unit={<Icon name="search" size={20} />}
            />
          </PickerField>
          <InfoList>
            <dt>{t('module')}</dt>
            <dd>{selectedArtifact?.Module?.displayName || '-'}</dd>
            <dt>{t('version')}</dt>
            <dd>{artifactVersion}</dd>
            <dt>{t('lastUpdated')}</dt>
            <dd>{formatDate(selectedArtifact?.updatedAt)}</dd>
          </InfoList>
        </Section>
        <Section gap="1.6rem">
          <SectionTitle title={t('rolloutSettings')} />
          <FieldGroup>
            <Dropdown
              label={t('timeoutPolicy')}
              size="lg"
              value={selectedPolicyId}
              placeholder={t('selectPolicy')}
              options={policyOptions}
              disabled={id}
              onChange={handlePolicyChange}
            />
            <Dropdown
              label={t('preAction')}
              size="lg"
              value={selectedPreActionId}
              placeholder={t('notSet')}
              options={actionOptions}
              disabled={id}
              onChange={handlePreActionChange}
            />
            <Dropdown
              label={t('postAction')}
              size="lg"
              value={selectedPostActionId}
              placeholder={t('notSet')}
              options={actionOptions}
              disabled={id}
              onChange={handlePostActionChange}
            />
          </FieldGroup>
        </Section>
      </DetailCardRow>
      <DetailCardRow>
        <Section gap="1.6rem">
          <SectionTitle
            title={
              <TitleWithHelp>
                {t('rolloutStage')}
                <InfoTooltipIcon tooltipId={TOOLTIP_ID} title={t('rolloutStage')} desc={t('rolloutStageHelp')} />
              </TitleWithHelp>
            }
          >
            <ToggleSwitch
              checked={rolloutStageEnabled}
              width="48px"
              disabled={!!id}
              onChange={(e) => setRolloutStageEnabled(e.target.checked)}
            />
          </SectionTitle>
          {rolloutStageEnabled && (
            <RolloutStageTable
              stages={stages}
              onChange={setStages}
              total={stagePoolUnits}
              pauseAfterEachStage={pauseAfterEachStage}
              onPauseChange={setPauseAfterEachStage}
              disabled={!!id}
              errors={stageErrors}
              robotPickerEnabled={isGroupDetail || canPickRobots}
              onOpenRobotPicker={handleOpenRobotPicker}
            />
          )}
          {rolloutStageEnabled && !isGroupDetail && !canPickRobots && (
            <SectionNotice className="typographyBody6">
              <InfoTooltipIcon
                tooltipId={TOOLTIP_ID}
                title={t('addedRobots')}
                desc={t('robotPickerUnavailableTooltip')}
              />
              {t('robotPickerUnavailableNotice')}
            </SectionNotice>
          )}
        </Section>
      </DetailCardRow>
      <DetailCardRow>
        <Section gap="1.6rem">
          <SectionTitle
            title={
              <TitleWithHelp>
                {t('rolloutSchedule')}
                <InfoTooltipIcon tooltipId={TOOLTIP_ID} title={t('rolloutSchedule')} desc={t('rolloutScheduleHelp')} />
              </TitleWithHelp>
            }
          >
            <ToggleSwitch
              checked={rolloutScheduleEnabled}
              width="48px"
              disabled={!!id}
              onChange={(e) => setRolloutScheduleEnabled(e.target.checked)}
            />
          </SectionTitle>
          {rolloutScheduleEnabled && (
            <>
              <ScheduleFieldRow>
                <div className="scheduleField">
                  <span className="fieldLabel typographyBody5">{t('date')}</span>
                  <Calendar type="date" startDate={scheduleDate} onChangeStartDate={setScheduleDate} disabled={!!id} />
                </div>
                <Input
                  label={t('time')}
                  size="lg"
                  type="time"
                  value={scheduleTime}
                  disabled={!!id}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
                <Dropdown
                  label={t('timezone')}
                  size="lg"
                  value={scheduleTimezone}
                  options={timezoneOptions}
                  disabled={!!id}
                  onChange={setScheduleTimezone}
                />
              </ScheduleFieldRow>
              <SectionNotice className="typographyBody6">
                <InfoTooltipIcon
                  tooltipId={TOOLTIP_ID}
                  title={t('rolloutSchedule')}
                  desc={t('scheduleStageTooltip')}
                />
                {t('scheduleStageNotice')}
              </SectionNotice>
            </>
          )}
        </Section>
      </DetailCardRow>
      <Modal
        isOpen={isArtifactModalOpen}
        size="xl"
        title={t('selectArtifact')}
        closeButton
        onClose={handleCloseArtifactModal}
        renderButtonComponent={
          <>
            <Button theme="secondary" onClick={handleCloseArtifactModal}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleConfirmArtifact} disabled={!pendingArtifactId}>
              {tCommon('confirm')}
            </Button>
          </>
        }
      >
        <ArtifactPickerBody>
          <HeaderTitleGroup>
            <Dropdown
              label={t('packageType')}
              size="lg"
              minWidth="200px"
              value={selectedPackageTypeId}
              placeholder={t('selectPackageType')}
              options={packageTypeOptions}
              disabled={id}
              onChange={handlePackageTypeChange}
            />
            <Dropdown
              label={t('module')}
              size="lg"
              minWidth="200px"
              value={selectedModuleId}
              placeholder={t('selectModule')}
              options={moduleOptions}
              disabled={id}
              onChange={handleModuleChange}
            />
            <Dropdown
              label={t('organization')}
              size="lg"
              minWidth="200px"
              value={selectedOrganizationId}
              placeholder={t('selectOrganization')}
              options={organizationOptions}
              disabled={id}
              onChange={handleOrganizationChange}
            />
            <SearchContainer>
              <Search
                label={tCommon('search')}
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={tCommon('searchPlaceHolder')}
                disabled={id}
                onReset={handleResetSearch}
              />
            </SearchContainer>
          </HeaderTitleGroup>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <ClipLoader color={'#36d7b7'} loading={true} size={50} />
            </div>
          ) : (
            <ArtifactTable
              data={filteredArtifactData}
              disabled={id}
              columns={tableHeader().columns}
              noData={tCommon('noData')}
              pagination
              paginationRowsPerPageOptions={[10, 30, 50, 100]}
            />
          )}
        </ArtifactPickerBody>
      </Modal>
      <UITooltip id={TOOLTIP_ID} />
      <RobotPickerModal
        key={`robot-picker-${robotPickerStageIndex ?? 'closed'}`}
        isOpen={robotPickerStageIndex !== null}
        stageNo={robotPickerStageIndex === null ? 0 : robotPickerStageIndex + 1}
        devices={pickerDevices}
        requiredCount={pickerRequiredCount}
        initialSelectedIds={pickerStage?.deviceIds || []}
        excludedIds={pickerExcludedIds}
        readOnly={!!id}
        onClose={() => setRobotPickerStageIndex(null)}
        onConfirm={handleConfirmRobotPicker}
      />
      <Modal isOpen={isDeploying} size="xs">
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <ClipLoader color={'#36d7b7'} loading={true} size={50} />
          <div style={{ marginTop: '20px' }}>{t('deploying')}</div>
        </div>
      </Modal>
    </StyledPageContent>
  )
}

export default CampaignDetail
