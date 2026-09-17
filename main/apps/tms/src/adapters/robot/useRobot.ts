import useRobotStore from './robot.store'

export function useRobot(robotId?: string) {
  const state = useRobotStore((s) => s.byId[robotId ?? ''])

  return {
    data: state?.data,
    status: state?.status ?? 'idle',
    error: state?.error,
    isLoading: state?.status === 'loading',
    isError: state?.status === 'error',
    updatedAt: state?.updatedAt
  }
}
