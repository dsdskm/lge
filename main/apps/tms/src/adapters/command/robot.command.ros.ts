import type { RobotCommand } from './robot.command'

export const useRosRobotCommand: RobotCommand = () => ({
  send: async () => ({ ok: false, error: new Error('rosbridge 제어는 아직 구현되지 않았습니다') }),
  isPending: false
})
