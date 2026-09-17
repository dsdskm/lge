import { useRestRobotCommand } from './robot.command.rest'

export type RobotCommandResult = { ok: boolean; error?: unknown }

export type RobotCommand = (robotId?: string) => {
  send: (params: { command: string; taskFlowId: number }) => Promise<RobotCommandResult>
  isPending: boolean
}

// rosbridge 제어 방식(topic / service)이 정해지지 않아 아직 프로파일로 분기하지 않는다.
// ros 구현이 준비되면 아래 형태로 되돌린다:
//   APP_PROFILE === 'device' ? useRosRobotCommand : useRestRobotCommand
export const useRobotCommand: RobotCommand = useRestRobotCommand
