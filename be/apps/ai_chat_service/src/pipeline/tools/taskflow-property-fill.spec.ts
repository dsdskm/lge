import { fillPropertiesFromMessage } from './taskflow-palette'

const task = (key: string, unitPhrases: Record<string, number>) =>
  ({
    taskId: 1,
    taskName: 'Timeout',
    taskType: 'CONTROL',
    roleSummary: '',
    triggerPhrases: [],
    contentType: '',
    composeHint: { properties: { [key]: { type: 'number', description: '', unitPhrases } } },
  }) as any

const MSEC = { 밀리초: 1, ms: 1, 초: 1000, s: 1000, 분: 60000 }

describe('fillPropertiesFromMessage', () => {
  it('문장의 "3초" 를 밀리초 값으로 채운다', () => {
    const result = fillPropertiesFromMessage(task('delay_msec', MSEC), {}, 'Love 노드 실행하고 3초 타임아웃 걸어줘')
    expect(result.properties).toEqual({ delay_msec: 3000 })
    expect(result.filledKeys).toEqual(['delay_msec'])
  })

  it('긴 단위가 먼저 잡혀 "500밀리초" 를 초로 오해하지 않는다', () => {
    const result = fillPropertiesFromMessage(task('delay_msec', MSEC), {}, '500밀리초 기다렸다가 실행해줘')
    expect(result.properties).toEqual({ delay_msec: 500 })
  })

  it('LLM 이 준 값이 있으면 건드리지 않는다', () => {
    const result = fillPropertiesFromMessage(task('delay_msec', MSEC), { delay_msec: 1000 }, '3초 타임아웃')
    expect(result.properties).toEqual({ delay_msec: 1000 })
    expect(result.filledKeys).toEqual([])
  })

  it('후보 값이 여러 개면 채우지 않는다', () => {
    const result = fillPropertiesFromMessage(task('delay_msec', MSEC), {}, '3초 기다리고 5초 타임아웃')
    expect(result.properties).toEqual({})
  })

  it('단위 표현이 없는 속성은 채우지 않는다', () => {
    const result = fillPropertiesFromMessage(task('success_count', {}), {}, '성공 카운트 2')
    expect(result.properties).toEqual({})
  })

  it('"3회" 는 배수 1 로 그대로 쓴다', () => {
    const repeat = task('num_cycles', { 회: 1, 번: 1 })
    expect(fillPropertiesFromMessage(repeat, {}, 'Love 얼굴 3회 반복해줘').properties).toEqual({ num_cycles: 3 })
  })
})
