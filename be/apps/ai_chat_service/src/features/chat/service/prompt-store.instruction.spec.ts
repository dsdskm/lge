import { PromptStoreService } from './prompt-store.service'
import { CHAT_PROMPT_TYPE } from '../prompt-types'

/** instruction 은 common -> 앱 -> 화면 순으로 이어 붙인다(intent-classifier 와 같은 규칙). */
function buildStore(rows: Array<{ id: number; screenKey: string; prompt: string; enabled?: boolean }>) {
  const store = new PromptStoreService({} as any, {} as any, {} as any, {} as any)
  const prompts = new Map<string, any>()
  for (const row of rows) {
    prompts.set(`${row.screenKey}::${CHAT_PROMPT_TYPE.instruction}`, {
      id: row.id,
      prompt: row.prompt,
      enabled: row.enabled !== false,
    })
  }
  ;(store as any).prompts = prompts
  return store
}

describe('PromptStoreService.getInstruction', () => {
  const rows = [
    { id: 1, screenKey: 'common', prompt: '공통 지시' },
    { id: 2, screenKey: 'robot', prompt: '로봇 앱 지시' },
    { id: 3, screenKey: 'robot/ailog/event', prompt: '이벤트 화면 지시' },
  ]

  it('common, 앱, 화면 지시를 순서대로 합친다', () => {
    const store = buildStore(rows)
    expect(store.getInstruction('robot', 'robot/ailog/event')).toBe('공통 지시\n\n로봇 앱 지시\n\n이벤트 화면 지시')
  })

  it('앱 키를 안 넘기면 화면 키 앞 조각에서 앱을 찾는다', () => {
    const store = buildStore(rows)
    expect(store.getInstruction('', 'robot/ailog/event')).toBe('공통 지시\n\n로봇 앱 지시\n\n이벤트 화면 지시')
  })

  it('앱이나 화면 지시가 없으면 common 만 쓴다', () => {
    const store = buildStore([rows[0]])
    expect(store.getInstruction('tms', 'tms/taskflows/:taskFlowId/canvas')).toBe('공통 지시')
  })

  it('비활성 행은 빼고 합친다', () => {
    const store = buildStore([rows[0], { ...rows[1], enabled: false }])
    expect(store.getInstruction('robot', 'robot/dashboard')).toBe('공통 지시')
  })

  it('어떤 단계가 쓰였는지 알려 준다', () => {
    const store = buildStore(rows)
    expect(store.describeInstructionSources('robot', 'robot/ailog/event')).toBe(
      'common:1, robot:2, robot/ailog/event:3',
    )
  })
})
