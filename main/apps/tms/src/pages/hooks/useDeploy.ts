import { useDeployTaskFlowAction } from '@/api/taskFlowApis'
import { DeployActionRequest, ReactFlowContent, TaskFlow } from '@/types/taskflow'
import { SimpleRobotInfo } from '@/types/taskflow'
import { DeployStatusType } from '@/types/RobotInfo'
import { Content } from '@/types/api/deviceDeployment'
import { DeviceResponse } from '@/types/api/device'

export type DeployMode = 'DEPLOY' | 'DELETE_DEPLOY'

/**
 * 배포/배포 취소 요청 한 건의 입력값.
 * (원래 DeployModal 에 있었지만 이 hook 만 쓰는 타입이고, 공용 hook 이 특정 화면의 컴포넌트를
 *  import 하면 순환 참조가 되므로 여기로 옮겼다)
 */
export interface DeployRequestParam {
  orgInfo: string[]
  taskFlowId: number
  robotList: SimpleRobotInfo[]
}

/**
 * 배포/배포 취소 한 건의 결과. 호출부가 여러 건을 돌릴 때 성공·실패를 집계할 수 있도록
 * 예외로 던지지 않고 값으로 돌려준다.
 */
export type DeployActionResult = { taskFlowId: number; ok: boolean; error?: unknown }

const useDeploy = () => {
  const {
    mutateAsync: deployActionMutateAsync,
    reset: deployActionReset,
    isPending: isDeployActionPending,
    isSuccess: isDeployActionSuccess,
    isError: isDeployActionError
  } = useDeployTaskFlowAction()

  /**
   * mutateAsync 는 실패하면 reject 하므로, 결과를 쓰지 않는 호출부(단건 배포)에서
   * unhandled rejection 이 되지 않도록 여기서 성공/실패를 값으로 바꿔 돌려준다.
   */
  const runDeployAction = async (request: DeployActionRequest, taskFlowId: number): Promise<DeployActionResult> => {
    try {
      await deployActionMutateAsync(request)
      return { taskFlowId, ok: true }
    } catch (error) {
      console.error('deploy action 실패', { taskFlowId, action: request.param.action, error })
      return { taskFlowId, ok: false, error }
    }
  }

  const execDeployAction = ({ orgInfo, taskFlowId, robotList }: DeployRequestParam) => {
    return runDeployAction(makeDeployActionRequest(orgInfo, taskFlowId, robotList), taskFlowId)
  }

  const execUnDeployAction = ({ orgInfo, taskFlowId, robotList }: DeployRequestParam) => {
    return runDeployAction(makeUndeployActionRequest(orgInfo, taskFlowId, robotList), taskFlowId)
  }

  const makeUndeployActionRequest = (
    orgInfo: string[],
    taskFlowId: number,
    robotList: SimpleRobotInfo[]
  ): DeployActionRequest => {
    const [selectedGroupId, selectedSiteId] = orgInfo
    return {
      taskFlowId: taskFlowId ?? -1,
      param: {
        action: 'UNDEPLOY',
        groupId: selectedGroupId,
        siteId: selectedSiteId,
        robotInfos: [...robotList],
        description: 'fixme'
      }
    }
  }

  const makeDeployActionRequest = (
    orgInfo: string[],
    taskFlowId: number,
    robotList: SimpleRobotInfo[]
  ): DeployActionRequest => {
    const [selectedGroupId, selectedSiteId] = orgInfo
    return {
      taskFlowId: taskFlowId ?? -1,
      param: {
        action: 'DEPLOY',
        groupId: selectedGroupId,
        siteId: selectedSiteId,
        robotInfos: [...robotList],
        description: 'fixme'
      }
    }
  }

  const getDeployActionStatus = () => {
    if (isDeployActionPending) {
      return 'WORKING'
    }
    if (isDeployActionError) {
      return 'FAILURE'
    }
    if (isDeployActionSuccess) {
      return 'SUCCESS'
    }
    return 'READY'
  }

  const makeDeployState = (robotId: string, deployContents: Content[]) => {
    const deployments = deployContents.find((content) => content.robotId === robotId)?.deployments ?? []
    if (deployments.length < 1) {
      return undefined
    }
    const deployment = deployments?.reduce((max, cur) => (max.taskFlowVersion >= cur.taskFlowVersion ? max : cur))
    return {
      taskFlowId: deployment.taskFlowId,
      taskFlowVersion: deployment.taskFlowVersion,
      status: deployment.status as DeployStatusType
    }
  }

  const makeDeployableInfo = (deployMode: DeployMode, device: DeviceResponse, taskFlow?: TaskFlow | null) => {
    if (deployMode === 'DEPLOY') {
      return checkDeployability(taskFlow, device)
    } else {
      return checkUndeployability(taskFlow, device)
    }
  }

  //todo
  function checkDeployability(taskFlow?: TaskFlow | null, robot?: DeviceResponse) {
    // taskFlow가 필요로 하는 skill과 로봇의 지원 skill이 다를 경우
    // taskFlow가 필요로 하는 action과 로봇의 지원 action이 다를 경우
    // 로봇에 이미 배포 TaskFlow 이상의 TaskFlow가 설치 되어 있을 경우

    if (!taskFlow) return { deployable: false, reason: 'taskflow_missing' }
    if (!robot?.tms) return { deployable: false, reason: 'robot_tms_missing' }

    console.log('checkDeployability', taskFlow)

    const capabilities = robot.tms.taskFlowState?.robotSpec?.capabilities ?? []
    const { robotSkillInfos: necessarySkill } = taskFlow

    for (const skill of necessarySkill) {
      if (!capabilities.some((capa) => capa.name === skill.name)) {
        return { deployable: false, reason: `not support skill` }
      }
    }

    const contents = taskFlow.flowDefinition.contents as ReactFlowContent[]

    for (const content of contents) {
      if (content.contentTypeName === 'POI') {
        const jsonObj = JSON.parse(content.contentValue)
        const robotLoc = robot.state?.sitePosition

        const isBuildingDiff = robotLoc?.buildingId && robotLoc.buildingId !== jsonObj.buildingId
        const isFloorDiff = robotLoc?.floorId && robotLoc.floorId !== jsonObj.floorId
        const isAreaDiff = robotLoc?.areaId && robotLoc.areaId !== jsonObj.areaId

        if (isBuildingDiff || isFloorDiff || isAreaDiff) {
          return { deployable: false, reason: 'cannot go location' }
        }
      }
    }
    return { deployable: true, reason: 'ok' }
  }

  function checkUndeployability(taskFlow?: TaskFlow | null, robot?: DeviceResponse) {
    if (!taskFlow || !robot) {
      return
    }
    return { deployable: true, reason: 'ok' }
  }

  return {
    execDeployAction,
    execUnDeployAction,
    getDeployActionStatus,
    deployActionReset,
    isDeployActionSuccess,
    isDeployActionPending,
    makeDeployState,
    makeDeployableInfo
  }
}

export default useDeploy
