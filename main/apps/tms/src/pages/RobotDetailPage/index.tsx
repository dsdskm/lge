import { StyledPageContent, Title, NoData, Checkbox, Button } from '@repo/ui'
import { useParams } from 'react-router-dom'
import TaskFlowList from './components/TaskFlowList'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlowArea, FlowCanvasWrap } from '../TaskFlowListDetailPage/styles'
import { useGetTaskFlow, useListTaskFlows } from '@/api/taskFlowApis'
import TaskFlowReadonlyCanvas from '../TaskFlowCanvasPage/FlowCanvasViewer'
import { useTranslation } from 'react-i18next'
import { CenteredContent, Section } from './styles'
import { toast } from 'react-toastify'
import { RobotTaskFlow } from '@/types/api/device'
import { Battery, Activity } from 'lucide-react'
import DeployModal from '../DeployPage/components/DeployModal'
import useDeploy from '@/pages/hooks/useDeploy'
import { useGetLatestDeployments } from '@/api/robotDeployApis'
import { useRobotSource } from '@/adapters/robot/robot.source'
import { useRobot } from '@/adapters/robot/useRobot'
import { useRobotCommand } from '@/adapters/command/robot.command'

const RobotDetailPage = () => {
  const { t } = useTranslation('tms')
  const { robotId } = useParams()
  const initialized = useRef(false)
  const [selectedId, setSelectedId] = useState(-1)
  const { data: taskFlowData } = useGetTaskFlow(selectedId)

  const [checkedItems, setCheckedItems] = useState<number[]>([])
  const [checkAll, setCheckAll] = useState(false)
  const [oneItemViewClicked, setOneItemViewClicked] = useState(false)
  const [popup, setPopup] = useState(false)

  /**
   * 선택한 taskflow 를 하나씩 배포 취소하는 동안의 진행/결과.
   *
   * useDeploy 의 재생 상태(isPending/isSuccess/isError)는 mutation 인스턴스가 하나뿐이라
   * 마지막 요청만 반영한다. 여러 건을 돌리면 앞쪽이 실패해도 마지막이 성공하면 성공으로
   * 보이므로, 모달 상태는 이 집계값으로 판단한다.
   */
  const [deploysResult, setDeploysResult] = useState<{
    total: number
    done: number
    failedIds: number[]
  } | null>(null)

  const { execUnDeployAction, deployActionReset, makeDeployState } = useDeploy()

  console.log('robot id check = ', robotId)

  useRobotSource(robotId ?? '')
  const { data, isError, isLoading } = useRobot(robotId)
  const robotData = data
  const robotDataError = isError
  const robotDataLoading = isLoading

  const group = robotData?.provision?.groupId
  const site = robotData?.provision?.siteId

  const { data: taskflowList } = useListTaskFlows(group ?? null, site ?? null)

  const deployInfoRequest = useMemo(() => {
    if (!taskFlowData) {
      return undefined
    }
    return {
      groupId: taskFlowData.groupId,
      siteId: taskFlowData.siteId,
      taskflowId: taskFlowData.id ?? -1
    }
  }, [taskFlowData])

  const { data: deployInfo } = useGetLatestDeployments(deployInfoRequest)
  console.log('deployInfo = ', deployInfo)

  const robotTaskFlows = useMemo(() => {
    let taskFlows = robotData?.tms?.taskFlowState?.taskFlows ?? []
    if (oneItemViewClicked) {
      taskFlows = taskFlows.filter((task) => task.id === selectedId)
    }

    return taskFlows.map((robotTask) => {
      const deployStatus = makeDeployState(robotData?.deviceId ?? '', deployInfo?.content ?? [])
      const orgTaskFlow = taskflowList?.find((task) => task.id === robotTask.id)

      return { ...robotTask, latestVersion: orgTaskFlow?.version }
    })
  }, [robotData?.tms?.taskFlowState?.taskFlows, taskflowList, oneItemViewClicked, deployInfo])

  console.log('robotTaskFlows', robotTaskFlows)

  useEffect(() => {
    if (initialized.current) return

    const taskFlows = robotData?.tms?.taskFlowState?.taskFlows ?? []
    if (taskFlows.length < 1) return

    const id = taskFlows.find((tf) => tf.operationStatus === 'RUNNING')?.id ?? taskFlows[0].id

    console.log('selected log', id)

    setSelectedId(id)
    initialized.current = true
  }, [robotData])

  const { send, isPending } = useRobotCommand(robotId)

  if (robotDataError) return <div>error</div>
  if (robotDataLoading) return <div>loading</div>

  const onTaskFlowSelect = (id: number) => {
    setSelectedId(id)
  }
  const onTaskFlowChecked = (id: number) => {
    setCheckedItems((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const onCheckAllClicked = (id: number) => {
    setCheckAll((prev) => {
      if (!prev) {
        setCheckedItems(robotTaskFlows.map((task) => task.id))
      } else {
        setCheckedItems([])
      }
      return !prev
    })
  }

  const onOneItemViewClicked = () => {
    setOneItemViewClicked(!oneItemViewClicked)
  }

  const onCommandClick = async (command: string, taskFlowId: number) => {
    // send 는 실패해도 던지지 않고 결과를 값으로 돌려준다.
    // 여기서 성공은 "요청이 접수됨"까지이고, 실제 반영 여부는 로봇 상태로 확인한다.
    const result = await send({ command, taskFlowId })

    if (result.ok) {
      toast.info('제어를 요청했습니다.')
    } else {
      toast.warning('제어 요청에 실패했습니다.')
    }
  }
  const onDeployPopupClicked = () => {
    setPopup(true)
  }

  const dismissPopup = () => {
    setPopup(false)
    if (deploysResult && deploysResult.done === deploysResult.total) {
      // 실패한 건은 재시도할 수 있게 선택을 남기고, 전부 성공했을 때만 비운다.
      setCheckedItems(deploysResult.failedIds)
      if (deploysResult.failedIds.length === 0) {
        setCheckAll(false)
      }
    }
    setDeploysResult(null)
    deployActionReset()
  }

  const changedTasks = robotData?.tms?.taskFlowState?.runningTaskFlowStatus
  const activePath = robotData?.tms?.taskFlowState?.runningTaskFlowStatus?.activePath ?? []
  const finalValue = activePath

  console.log('changed task', changedTasks?.changedTasks)
  console.log('active task', finalValue)

  const taskFlowList = robotData?.tms?.taskFlowState?.taskFlows ?? []

  const charge = robotData?.state?.batteryState?.batteryCharge
  const batteryColor = (charge ?? 0) > 60 ? '#16a34a' : (charge ?? 0) > 20 ? '#d97706' : '#dc2626'
  const isStandby = robotData?.deviceState === 'STANDBY'
  const taskFlows = taskFlowList
    .filter((task) => checkedItems.includes(task.id))
    .map((task) => {
      return { name: task.name, id: task.id, version: task.version }
    })

  console.log('taskFlowData', taskFlowData)

  const title = taskFlows[0]?.name + '(' + '외' + taskFlows.length + ')' + t('deploy.modal.undeployTitleSuffix')

  // 여러 건을 순차로 보내므로 공유 mutation 상태(getDeployActionStatus) 대신 집계값으로 판단한다.
  // 한 건이라도 실패하면 FAILURE 다.
  const deployStatus = (): 'READY' | 'WORKING' | 'SUCCESS' | 'FAILURE' => {
    if (!deploysResult) return 'READY'
    if (deploysResult.done < deploysResult.total) return 'WORKING'
    return deploysResult.failedIds.length > 0 ? 'FAILURE' : 'SUCCESS'
  }

  const mainDesc = () => {
    switch (deployStatus()) {
      case 'READY':
        return (
          t('deploy.modal.selectedPrefix') +
          t('deploy.taskFlowUnit', { count: +checkedItems.length }) +
          t('deploy.modal.undeployTasksSuffix')
        )

      case 'WORKING':
        // 순차 처리라 몇 번째를 보내고 있는지 알려준다.
        return deploysResult && deploysResult.total > 1
          ? `${t('deploy.modal.undeploying')} (${deploysResult.done}/${deploysResult.total})`
          : t('deploy.modal.undeploying')

      case 'SUCCESS':
        return t('deploy.modal.undeployRequested')

      case 'FAILURE':
        return t('deploy.modal.undeployPartialFailed', {
          failed: deploysResult?.failedIds.length ?? 0,
          total: deploysResult?.total ?? 0
        })
    }
  }

  const subDesc = () => {
    if (deployStatus() === 'READY') {
      return t('deploy.modal.irreversible')
    }
    // 실패한 건은 선택이 남아 있으므로 다시 시도할 수 있다.
    if (deployStatus() === 'FAILURE') {
      return t('deploy.modal.undeployRetryHint')
    }
  }

  return (
    <>
      {popup && (
        <DeployModal
          title={title}
          desc={mainDesc()}
          subDesc={subDesc()}
          mode={'DELETE_DEPLOY'}
          status={deployStatus()}
          onClose={dismissPopup}
          onDeploy={async () => {
            if (!group || !site || !robotData?.deviceId || taskFlows.length === 0) return
            // 진행 중 재클릭 방지(모달 버튼도 WORKING 이면 비활성이지만 첫 렌더 전 클릭을 막는다).
            if (deploysResult) return

            const deviceId = robotData.deviceId
            const targets = taskFlows
            setDeploysResult({ total: targets.length, done: 0, failedIds: [] })

            // mutation 인스턴스를 하나 공유하므로 병렬로 쏘면 상태와 콜백이 서로를 덮어쓴다.
            // 한 건씩 보내고 결과를 모은다.
            const failedIds: number[] = []
            for (const task of targets) {
              const result = await execUnDeployAction({
                orgInfo: [group, site],
                taskFlowId: task.id,
                robotList: [{ groupId: group, siteId: site, id: deviceId }]
              })

              if (!result.ok) failedIds.push(task.id)
              setDeploysResult((prev) => (prev ? { ...prev, done: prev.done + 1, failedIds: [...failedIds] } : prev))
            }

            if (failedIds.length > 0) {
              // 사용자 안내는 모달(desc)이 담당한다. 여기 로그는 원인 추적용.
              console.error(
                '배포 취소 실패:',
                targets.filter((task) => failedIds.includes(task.id))
              )
            }
          }}
        ></DeployModal>
      )}
      <StyledPageContent className="column">
        <Title>{robotData?.deviceName}</Title>
        <div
          style={{
            textAlign: 'start',
            border: '2px solid #ebedf0',
            borderRadius: '8px',
            backgroundColor: 'white',
            marginBottom: '24px',
            padding: '24px',
            display: 'flex', // 추가
            flexDirection: 'column', // 추가
            gap: '8px' // 추가 — 줄 간격
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>상태 : </span>
            <Activity size={14} color={isStandby ? '#16a34a' : '#9ca3af'} />
            <span style={{ color: isStandby ? '#16a34a' : '#9ca3af' }}>{robotData?.deviceState}</span>
          </span>

          {charge != null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>배터리 레벨 : </span>
              <Battery size={14} color={batteryColor} />
              <span style={{ color: batteryColor }}>{charge}%</span>
            </span>
          )}
          <div style={{ display: 'flex', gap: '2px' }}>
            <span>{t('robots.installedCount')}:</span>
            <span style={{ color: '#9ca3af' }}>{robotData?.tms?.taskFlowState?.taskFlows?.length ?? 0}</span>
          </div>
        </div>

        {taskFlowList.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <Checkbox
                  type="checkbox"
                  checked={checkAll}
                  onChange={onCheckAllClicked}
                  style={{ height: '16px', width: '16px', cursor: 'pointer' }}
                />
                <label style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>{t('deploy.selectAll')}</label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '5px' }}>
                <Button onClick={onOneItemViewClicked}>{oneItemViewClicked ? '확대' : '축소'}</Button>
                <Button
                  onClick={() => {
                    onDeployPopupClicked()
                  }}
                  disabled={checkedItems.length < 1}
                >
                  삭제
                </Button>
              </div>
            </div>

            <CenteredContent>
              <TaskFlowList
                taskFlowList={robotTaskFlows as RobotTaskFlow[]}
                controlList={[
                  {
                    title: t('robotDetail.control.start'),
                    command: 'start',
                    onRequest: !isPending,
                    execute: onCommandClick
                  },
                  {
                    title: t('robotDetail.control.proceed'),
                    command: 'proceed',
                    onRequest: !isPending,
                    execute: onCommandClick
                  },
                  {
                    title: t('robotDetail.control.pause'),
                    command: 'pause',
                    onRequest: !isPending,
                    execute: onCommandClick
                  },
                  {
                    title: t('robotDetail.control.resume'),
                    command: 'resume',
                    onRequest: !isPending,
                    execute: onCommandClick
                  },
                  {
                    title: t('robotDetail.control.stop'),
                    command: 'stop',
                    onRequest: !isPending,
                    execute: onCommandClick
                  }
                ]}
                // settingList={[
                //   [
                //     {
                //       title: t('robotDetail.control.use'),
                //       command: 'enable',
                //       onRequest: !isPending,
                //       execute: onCommandClick
                //     },
                //     {
                //       title: t('robotDetail.control.unuse'),
                //       command: 'disable',
                //       onRequest: !isPending,
                //       execute: onCommandClick
                //     }
                //   ]
                // ]}
                selectedId={selectedId}
                onListClick={onTaskFlowSelect}
                onItemChecked={onTaskFlowChecked}
                checkedItems={checkedItems}
              />
            </CenteredContent>
            <CenteredContent>
              <Section>
                <FlowArea>
                  <FlowCanvasWrap>
                    <TaskFlowReadonlyCanvas
                      flowDefinition={taskFlowData?.flowDefinition}
                      activeNodeList={activePath}
                      displayOption="RUNNING_STATUS"
                      flowName={taskFlowData?.name}
                    />
                  </FlowCanvasWrap>
                </FlowArea>
              </Section>
            </CenteredContent>
          </>
        )}
      </StyledPageContent>
    </>
  )
}

export default RobotDetailPage
