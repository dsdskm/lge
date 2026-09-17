import { useDevice } from '@/api/deviceApis'
import useRobotStore from './robot.store'
import { useEffect } from 'react'

export function useRestRobotSource(robotId?: string) {
  const { data, isLoading, error } = useDevice(robotId, 1500)
  const setRobot = useRobotStore((s) => s.setRobot)

  useEffect(() => {
    if (!robotId) return
    setRobot(robotId, {
      data,
      status: isLoading ? 'loading' : error ? 'error' : data ? 'ready' : 'idle',
      error
    })
  }, [data, robotId, isLoading, error])
}
