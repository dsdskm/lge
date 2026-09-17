import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RobotList from '@/pages/components/robot/RobotList'
import { makeBuildingInfo, toRobotInfo } from '@/pages/components/robot/toRobotInfo'
import type { RobotInfo } from '../../types/RobotInfo'
import { useDeviceList } from '../../api/deviceApis'
import DeployModal from './components/DeployModal'
import { useParams } from 'react-router-dom'

import { StyledPageContent, Title, Tabs, Tab, Dropdown, Search, HeaderTitleGroup, Checkbox, Button } from '@repo/ui'
import { useGetTaskFlow } from '@/api/taskFlowApis'
import { ReactFlowContent, TaskFlow } from '@/types/taskflow'
import { DeviceResponse } from '@/types/api/device'
import useSelectInfo from './hooks/useSelectInfo'
import { useGetLatestDeployments } from '@/api/robotDeployApis'
import { useOrganizationStore } from '@repo/stores'
import { DeployContent, DeploySearchContainer } from './styles'
import useDeploy, { DeployMode } from '@/pages/hooks/useDeploy'
import SkillIndicator from '../components/SkillIndicator'
import { useOrgFilterValues } from '../hooks/useOrgFilter'
import { useSite } from '@/api/siteApi'
import { SEP } from '@/common/constants'

const operationStatusOptions = [
  { value: 'all', name: 'all' },
  { value: 'POWEROFF', name: 'POWEROFF' },
  { value: 'OFFLINE', name: 'OFFLINE' },
  { value: 'ERROR', name: 'ERROR' },
  { value: 'CHARGE', name: 'CHARGE' },
  { value: 'STANDBY', name: 'STANDBY' },
  { value: 'OPERATION', name: 'OPERATION' }
]

const deployStatusOptions = [
  { value: 'all', name: 'all' },
  { value: 'QUEUED', name: 'queued' },
  { value: 'IN_PROGRESS', name: 'in progress' },
  { value: 'SUCCEEDED', name: 'succeeded' },
  { value: 'FAILED', name: 'failed' },
  { value: 'TIMED_OUT', name: 'time out' },
  { value: 'REJECTED', name: 'rejected' },
  { value: 'REMOVED', name: 'removed' },
  { value: 'CANCELED', name: 'canceled' }
]

function checkUndeployability(taskFlow?: TaskFlow | null, robot?: DeviceResponse) {
  if (!taskFlow || !robot) {
    return
  }
  return { deployable: true, reason: 'ok' }
}

function getRobotForMode(
  deployMode: DeployMode,
  content: DeviceResponse[] | undefined,
  taskFlow?: TaskFlow | null
): DeviceResponse[] {
  if (!content) return []
  if (!taskFlow) return content
  const { id: taskFlowId, version: taskFlowVer } = taskFlow

  const findInstalled = (device: DeviceResponse) =>
    device.tms?.taskFlowState?.taskFlows?.find((tf) => tf.id === taskFlowId)

  if (deployMode === 'DEPLOY') {
    return content.filter((device) => {
      const installed = findInstalled(device)
      return !installed || installed.version < taskFlowVer
    })
  }

  // UNDEPLOY: 동일 id가 깔려 있는 디바이스
  return content.filter((device) => !!findInstalled(device))
}

const DeployPage = () => {
  const { t } = useTranslation(['tms', 'common'])
  const { taskFlowId } = useParams()
  const numericFlowId = Number(taskFlowId)
  const [popup, setPopup] = useState(false)
  const [deployMode, setDeployMode] = useState<DeployMode>('DEPLOY')
  const deploy = useSelectInfo()
  const undeploy = useSelectInfo()
  const active = deployMode === 'DEPLOY' ? deploy : undeploy
  const { selectedOrgs } = useOrganizationStore()
  // 이 화면은 조직 셀렉터를 직접 렌더하지 않고 전역 선택(selectedOrgs)을 그대로 따르므로
  // 상태를 갖지 않는 파생 버전을 쓴다.
  const { deviceParams, matchesOrgFilter } = useOrgFilterValues(selectedOrgs)

  const {
    data: taskFlowData,
    error: taskFlowError,
    isLoading: taskFlowLoading,
    isSuccess: tfSuccess
  } = useGetTaskFlow(numericFlowId)

  const {
    data: devicesData,
    error: devicesError,
    isLoading: devicesLoading,
    isSuccess: dlSuccess
  } = useDeviceList(deviceParams, tfSuccess)

  const { data: siteInfo } = useSite(selectedOrgs[1])

  const deployInfoRequest = useMemo(() => {
    console.log('taskflow 확인 ', taskFlowData)
    if (!taskFlowData || !devicesData?.content) {
      return undefined
    }

    return {
      groupId: taskFlowData.groupId,
      siteId: taskFlowData.siteId,
      taskflowId: taskFlowData.id ?? -1
    }
  }, [taskFlowData, devicesData])

  const { data: deployInfo } = useGetLatestDeployments(deployInfoRequest, tfSuccess && dlSuccess)

  console.log('devicesData', devicesData)

  const {
    execDeployAction,
    execUnDeployAction,
    getDeployActionStatus,
    deployActionReset,
    isDeployActionSuccess,
    isDeployActionPending,
    makeDeployState,
    makeDeployableInfo
  } = useDeploy()

  const buildingInfo = useMemo(() => makeBuildingInfo(siteInfo?.buildings), [siteInfo])
  const taskflowLoc = useMemo(() => {
    const contents = (taskFlowData?.flowDefinition.contents as ReactFlowContent[]) ?? []
    const locationSet = new Set<string>()

    for (const content of contents) {
      if (content.contentTypeName === 'POI') {
        const jsonObj = JSON.parse(content.contentValue)
        const bName = buildingInfo.get(jsonObj.buildingId) ?? ''
        const fName = buildingInfo.get(jsonObj.floorId) ?? ''
        const aName = buildingInfo.get(jsonObj.areaId) ?? ''

        const locStr = `${bName}${SEP}${fName}${SEP}${aName}`

        locationSet.add(locStr)
      }
    }
    return [...locationSet]
  }, [taskFlowData, buildingInfo])

  const robotList: RobotInfo[] = useMemo(() => {
    const targetRobots = getRobotForMode(deployMode, devicesData?.content, taskFlowData)
    const buckets: Record<
      'deployable' | 'undeployable',
      Record<string, { groupName: string; siteName: string; robots: RobotInfo[] }>
    > = { deployable: {}, undeployable: {} }

    let robot: RobotInfo

    for (const device of targetRobots) {
      const deployStatus = makeDeployState(device.deviceId, deployInfo?.content ?? [])
      const deployable = makeDeployableInfo(deployMode, device, taskFlowData)
      robot = {
        ...toRobotInfo(device, buildingInfo),
        deployable: deployable,
        deployStatus: deployStatus
      }
      // console.log('device info', device)
      // console.log('robot info', robot)

      if (!matchesOrgFilter(robot)) {
        continue
      }

      const groupName = robot.group ?? t('deploy.unassignedGroup')
      const siteName = robot.site ?? t('deploy.unassignedSite')
      const key = `${groupName}__${siteName}`
      const target = robot.deployable ? buckets.deployable : buckets.undeployable

      if (!target[key]) {
        target[key] = { groupName, siteName, robots: [] }
      }
      target[key].robots.push(robot)
    }

    let result: RobotInfo[] = []
    const appendSection = (deployable: boolean) => {
      const sectionMap = deployable ? buckets.deployable : buckets.undeployable
      const sections = Object.values(sectionMap)
      if (sections.length === 0) return

      // 그룹 정렬: groupName → siteName
      sections
        .sort((a, b) => {
          const g = a.groupName.localeCompare(b.groupName)
          return g !== 0 ? g : a.siteName.localeCompare(b.siteName)
        })
        .forEach((section) => {
          ;[...section.robots]
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((robot) => {
              result.push(robot)
            })
        })
    }
    appendSection(true)
    appendSection(false)

    if (active.deployStatusFilter !== 'all') {
      result = result.filter((e) => e.deployStatus?.status === active.deployStatusFilter)
    }

    if (active.operationStatusFilter !== 'all') {
      console.log('active.operationStatusFilter', active.operationStatusFilter)
      result = result.filter((e) => {
        console.log('target status', e.status)
        return e.status === active.operationStatusFilter
      })
    }

    console.log('after result', result)

    return result
    // matchesOrgFilter 를 dep 에 넣어야 한다: 조직 선택이 바뀌어도 조회 파라미터가 같을 수 있어
    // (예: 그룹 none→all 인데 사이트가 none 이면 서버 파라미터는 그대로 {}) devicesData 만 보면
    // 목록이 갱신되지 않는다. 파생 hook 이 참조를 안정화하므로 dep 에 넣어도 재계산이 늘지 않는다.
  }, [
    devicesData,
    deployMode,
    deployInfo,
    taskFlowData,
    active.deployStatusFilter,
    active.operationStatusFilter,
    matchesOrgFilter,
    buildingInfo
  ])

  if (taskFlowLoading || devicesLoading) return <p>Loading...</p>
  if (taskFlowError) return <p>error: {taskFlowError.message}</p>
  if (devicesError) return <p>error: {devicesError.message}</p>

  const onClickDeploy = () => {
    setPopup(true)
    console.log('click deploy')
  }

  const onTabClick = (id: DeployMode) => {
    setDeployMode(id)
    console.log('onTabClick', deployMode)
  }

  const onOperationStatusOptionChaged = (value: string) => {
    active.setOperationStatusFilter(value)
  }

  const onDeployStatusOptionChaged = (value: string) => {
    active.setDeployStatusFilter(value)
  }

  const dismissPopup = () => {
    setPopup(false)
    if (isDeployActionSuccess) {
      active.onSelectAllChanged(false)
      active.onSelectedRobotChanged([])
    }
    deployActionReset()
  }

  const toggleRobotSelection = (robot: RobotInfo) => {
    if (!robot.deployable?.deployable) return
    active.onSelectedRobotChanged(robot)
  }

  const handleSelectAll = () => {
    if (active.selectAll) {
      active.onSelectedRobotChanged([])
    } else {
      active.onSelectedRobotChanged(robotList.filter((item) => item.deployable?.deployable))
    }
    active.onSelectAllChanged(!active.selectAll)
  }

  const skills = taskFlowData?.robotSkillInfos ?? []

  console.log('skillset ', skills)

  const title =
    taskFlowData?.name +
    ' ' +
    (deployMode === 'DEPLOY'
      ? t('deploy.modal.deployTitleSuffix', { version: taskFlowData?.version })
      : t('deploy.modal.undeployTitleSuffix'))

  const mainDesc = () => {
    switch (getDeployActionStatus()) {
      case 'READY':
        let desc =
          deployMode === 'DEPLOY'
            ? t('deploy.modal.selectedPrefix') +
              t('deploy.unit', { count: active.selectedRobotList.length }) +
              t('deploy.modal.deploySuffix')
            : t('deploy.modal.selectedPrefix') +
              t('deploy.unit', { count: active.selectedRobotList.length }) +
              t('deploy.modal.undeploySuffix')
        return desc

      case 'WORKING':
        return deployMode === 'DEPLOY' ? t('deploy.modal.deploying') : t('deploy.modal.undeploying')

      case 'SUCCESS':
        return deployMode === 'DEPLOY' ? t('deploy.modal.deployRequested') : t('deploy.modal.undeployRequested')

      case 'FAILURE':
        return deployMode === 'DEPLOY' ? t('deploy.modal.deployFailed') : t('deploy.modal.undeployFailed')
    }
  }

  const subDesc = () => {
    if (getDeployActionStatus() === 'READY') {
      return t('deploy.modal.irreversible')
    }
  }

  return (
    <>
      {popup && (
        <DeployModal
          title={title}
          desc={mainDesc()}
          subDesc={subDesc()}
          mode={deployMode}
          status={getDeployActionStatus()}
          onClose={dismissPopup}
          onDeploy={() => {
            if (!taskFlowData?.id) return
            const params = {
              orgInfo: selectedOrgs,
              taskFlowId: taskFlowData.id,
              robotList: [...active.selectedRobotList]
            }
            deployMode === 'DEPLOY' ? execDeployAction(params) : execUnDeployAction(params)
          }}
        ></DeployModal>
      )}

      <StyledPageContent className="column">
        <Title>{t('deploy.title')}</Title>
        <DeployContent>
          <div
            style={{
              textAlign: 'start',
              border: '2px solid #ebedf0',
              borderRadius: '8px',
              backgroundColor: 'white',
              marginBottom: '24px',
              padding: '24px'
            }}
          >
            <h2
              style={{
                margin: '0 0 12px 0',
                fontSize: '18px',
                fontWeight: 600,
                color: '#1f2937'
              }}
            >
              {taskFlowData?.name} v{taskFlowData?.version}
            </h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: '14px',
                color: '#4b5563'
              }}
            >
              {(taskFlowData?.description ?? '').length > 0 && (
                <p style={{ margin: 0 }}>- {taskFlowData?.description}</p>
              )}
              {skills.length > 0 && (
                <p
                  style={{
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  - {t('deploy.requiredSkills')}
                  {skills.map((item) => (
                    <span
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {<SkillIndicator skill={item.name} />}
                    </span>
                  ))}
                </p>
              )}
              {taskflowLoc.length > 0 && (
                <p
                  style={{
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  - {t('deploy.locations')}
                  {taskflowLoc.map((item) => (
                    <span
                      key={item}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>

          <Tabs defaultActiveId="DEPLOY" onChange={onTabClick}>
            <Tab id="DEPLOY" label={t('deploy.deploy')}></Tab>
            <Tab id="DELETE_DEPLOY" label={t('deploy.undeploy')}></Tab>
          </Tabs>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Checkbox checked={active.selectAll} onChange={handleSelectAll} />
            <label style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>{t('deploy.selectAll')}</label>
          </div>
          <HeaderTitleGroup style={{ marginBottom: '16px', justifyContent: 'flex-start' }}>
            <DeploySearchContainer>
              <Search
                width="250px"
                value={active.robotSearchQuery}
                onChange={(e: any) => active.onRobotSearchQueryChanged(e.target.value)}
                placeholder={t('deploy.searchRobot')}
              />
            </DeploySearchContainer>
            <Dropdown
              size="lg"
              minWidth="180px"
              defaultValue={'all'}
              value={active.operationStatusFilter}
              options={operationStatusOptions}
              onChange={onOperationStatusOptionChaged}
            />
            <Dropdown
              size="lg"
              minWidth="180px"
              defaultValue={'all'}
              value={active.deployStatusFilter}
              options={deployStatusOptions}
              onChange={onDeployStatusOptionChaged}
            />
          </HeaderTitleGroup>
          <RobotList
            mode="DEPLOY"
            robotList={robotList}
            necessarySkills={skills.map((item) => item.name)}
            searchQuery={active.robotSearchQuery}
            selectedRobotIds={active.selectedRobotList}
            onChangeCheckbox={toggleRobotSelection}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              textAlign: 'start',
              border: '2px solid #ebedf0',
              borderRadius: '8px',
              backgroundColor: 'white'
            }}
          >
            <p style={{ margin: 0, fontSize: '14px', color: '#4b5563' }}>
              {t('deploy.selectedCount', { count: active.selectedRobotList.length })}
            </p>
            <Button disabled={active.selectedRobotList.length === 0 || isDeployActionPending} onClick={onClickDeploy}>
              {' '}
              {deployMode === 'DEPLOY' ? t('deploy.deploy') : t('deploy.undeploy')}{' '}
            </Button>
          </div>
        </DeployContent>
      </StyledPageContent>
    </>
  )
}

export default DeployPage
