import { DeviceResponse } from '@/types/api/device'
import { create } from 'zustand'

interface State {
  data?: DeviceResponse // 기존 타입을 그대로 계약으로
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: unknown
  updatedAt?: number // 값이 멈췄는지 판단용
}

interface RobotState {
  byId: Record<string, State>
  connection: 'connected' | 'disconnected' | 'connecting'
  setRobot: (robotId: string, robotState: State) => void
  setConnection: (status: RobotState['connection']) => void
}

const useRobotStore = create<RobotState>((set) => ({
  byId: {},
  connection: 'disconnected',
  setRobot(robotId: string, robotState: State) {
    set((prv) => ({
      byId: {
        ...prv.byId,
        [robotId]: {
          ...prv.byId[robotId],
          ...robotState,
          updatedAt: Date.now()
        }
      }
    }))
  },
  setConnection(status: RobotState['connection']) {
    set({ connection: status })
  }
}))

export default useRobotStore
