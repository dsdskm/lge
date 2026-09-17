import { APP_PROFILE } from '@/common/profile'
import { useRestRobotSource } from './robot.source.rest'
import { useRosRobotSource } from './robot.source.ros'

export type RobotSource = (robotId?: string) => void
export const useRobotSource: RobotSource = APP_PROFILE === 'device' ? useRosRobotSource : useRestRobotSource
