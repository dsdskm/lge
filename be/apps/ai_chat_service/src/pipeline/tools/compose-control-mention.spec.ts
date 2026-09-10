import { mentionsControlTask } from './compose-taskflow-tree.tool'

const tasks = [
  { taskName: 'Parallel', taskType: 'CONTROL', triggerPhrases: ['동시에', 'parallel'] },
  { taskName: 'IfThenElse', taskType: 'CONTROL', triggerPhrases: ['성공하면', '실패하면', 'ifthenelse'] },
  { taskName: 'PlayMotion', taskType: 'ACTION', triggerPhrases: ['모션'] },
  { taskName: 'PlayFace', taskType: 'ACTION', triggerPhrases: ['얼굴'] },
] as any[]

const store = {
  list: () => tasks,
  get: (name: string) => tasks.find((task) => task.taskName === name),
} as any

describe('mentionsControlTask', () => {
  it('동시 실행 요청에서 제어 Task 를 찾는다', () => {
    expect(
      mentionsControlTask('인트로 tts, bouquet_hand_present 모션, Love 얼굴을 동시에 수행하는 parallel을 만들어줘', store)
        ?.taskName,
    ).toBe('Parallel')
  })

  it('조건 분기 요청에서 제어 Task 를 찾는다', () => {
    expect(
      mentionsControlTask(
        'thumb_up 모션 성공하면 Love 얼굴, 실패하면 Idle 얼굴 보이게 하는 ifThenElse 노드를 만들고 두번쨰 Pause 노드 우측에 연결해줘',
        store,
      )?.taskName,
    ).toBe('IfThenElse')
  })

  it('순차 요청에는 제어 Task 가 없다', () => {
    expect(mentionsControlTask('도슨트 환영 장소 이동해서 1.인트로 발화해줘', store)).toBeUndefined()
  })
})
