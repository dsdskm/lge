import { readFileSync } from 'fs'
import { join } from 'path'
import { TASKFLOW_MESSAGE_KEY, taskflowNodeGuideKey } from './taskflow-message'

/** prompt(action-tools) 행에 넣는 JSON. DB 값과 같은 내용이라 키 규칙을 여기서 검증한다. */
const bundle: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, '../../../prompt45.action-tools.new.json'), 'utf8'),
)

describe('action-tools 프롬프트 키', () => {
  it('코드가 찾는 키가 모두 프롬프트에 있다', () => {
    const missing = Object.values(TASKFLOW_MESSAGE_KEY).filter((key) => bundle[key] === undefined)
    expect(missing).toEqual([])
  })

  it('프롬프트에 코드가 쓰지 않는 키가 없다(노드별 지침은 예외)', () => {
    const known = new Set<string>(Object.values(TASKFLOW_MESSAGE_KEY))
    const unused = Object.keys(bundle).filter((key) => !known.has(key) && !/^llm\.tool\.\w+\.node\./.test(key))
    expect(unused).toEqual([])
  })

  it('키는 llm. / ui. 두 갈래만 쓴다(표기·한도 같은 상수는 코드에 둔다)', () => {
    const offenders = Object.keys(bundle).filter((key) => !/^(llm|ui)\./.test(key))
    expect(offenders).toEqual([])
  })

  it('LLM 에 실리는 문구는 llm. 아래에만 둔다', () => {
    const llmChars = Object.entries(bundle)
      .filter(([key]) => key.startsWith('llm.'))
      .reduce((total, [, value]) => total + String(value).length, 0)

    expect(llmChars).toBeGreaterThan(0)
    expect(bundle[TASKFLOW_MESSAGE_KEY.toolEdit]).toContain('{{nodeGuides}}')
    expect(bundle[TASKFLOW_MESSAGE_KEY.toolCompose]).toContain('{{nodeGuides}}')
  })

  it('제어 노드 지침은 Task 이름별 키로 나뉘어 있다', () => {
    for (const taskName of ['IfThenElse', 'Parallel', 'Repeat', 'Delay', 'Timeout']) {
      expect(bundle[taskflowNodeGuideKey('edit', taskName)]).toBeDefined()
    }
    for (const taskName of ['IfThenElse', 'Parallel']) {
      expect(bundle[taskflowNodeGuideKey('compose', taskName)]).toBeDefined()
    }
  })
})
