import { useInstantAction } from '@/api/deviceControlApis'
import { InstantAction, InstantActionsPayload } from '@/types/api/deviceControl'
import { useUserStore } from '@repo/stores'
import type { RobotCommand, RobotCommandResult } from './robot.command'

const createInstantAction = (
  actionType: string,
  params?: Record<string, string | number | boolean>,
  blockingType: InstantAction['blockingType'] = 'NONE'
): InstantAction => {
  return {
    actionType,
    actionId: crypto.randomUUID(),
    blockingType,
    actionParameters: params ? Object.entries(params).map(([key, value]) => ({ key, value })) : undefined
  }
}

const createInstantActionsRequestBody = (userId: string, actions: InstantAction[]): InstantActionsPayload => {
  return {
    userId: userId,
    actions: actions
  }
}

const makeBody = (userId: string, command: string, taskFlowId: number): InstantActionsPayload =>
  createInstantActionsRequestBody(userId, [createInstantAction(command, { tms_id: String(taskFlowId) }, 'HARD')])

export const useRestRobotCommand: RobotCommand = (robotId) => {
  const { mutateAsync, isPending } = useInstantAction()
  const { session } = useUserStore()

  const send = async ({
    command,
    taskFlowId
  }: {
    command: string
    taskFlowId: number
  }): Promise<RobotCommandResult> => {
    try {
      await mutateAsync({
        deviceId: robotId ?? '',
        body: makeBody(session?.userId ?? '', command, taskFlowId)
      })
      return { ok: true }
    } catch (error) {
      console.error('제어 요청 실패', { robotId, command, taskFlowId, error })
      return { ok: false, error }
    }
  }

  return { send, isPending }
}
