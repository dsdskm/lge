import { parseComposeNodesFromMessage, splitClauses } from './taskflow-nl-compose'
import type { TaskSemantics } from '../../features/taskflow/service/property-tms-store.service'
import type { TaskContentRef } from './taskflow-palette'

const RULES = {
  clauseSeparatorPhrases: [
    '해서',
    '하고 나서',
    '하고나서',
    '한 다음',
    '한다음',
    '그 다음',
    '그다음',
    '다음에',
    '그리고',
    '하고',
    '해주고',
    '하며',
    '하면서',
  ],
  clauseNoisePhrases: ['으로', '로', '에서', '에게', '좀', '다시', '먼저', '그리고', '해줘', '해 줘', '해주세요'],
}

const task = (taskName: string, triggerPhrases: string[], nameSuffixes: string[] = []): TaskSemantics => ({
  taskId: 1,
  taskName,
  taskType: 'ACTION',
  roleSummary: '',
  triggerPhrases,
  contentType: '',
  composeHint: nameSuffixes.length > 0 ? { nameSuffixes } : {},
})

// nameSuffixes 는 property_tms.compose_hint 에서 온다(sql/20260909_ai_chat_task_name_suffixes.sql).
const TASKS: TaskSemantics[] = [
  task('MoveTo', ['이동', '가줘', '가서', '이동해', '출발', '로가', 'move'], ['장소', 'POI', '위치', '지점']),
  task('Tts', ['말해', '발화', '안내', '멘트', '읽어', '이야기해', 'tts'], ['음성', '발화', '멘트', '안내']),
  task('PlayMotion', ['모션', '동작', '제스처', '움직여', 'motion'], ['모션', '동작', '제스처']),
  task('PlayFace', ['표정', '얼굴', '표시', '표시해', '보여줘', 'face'], ['얼굴', '표정']),
  task('Rotate', ['회전', '돌아', '돌려', '좌회전', '우회전', 'rotate']),
]

const content = (taskName: string, contentName: string, contentId: number): TaskContentRef => ({
  taskId: 1,
  taskName,
  contentName,
  contentId,
})

const CONTENTS: TaskContentRef[] = [
  content('MoveTo', '도슨트 환영 장소', 11),
  content('MoveTo', '도슨트 안내 장소', 12),
  content('MoveTo', '도슨트 대기 장소', 13),
  content('Tts', '1.인트로', 21),
  content('Tts', '2.TV 구조도 설명1', 22),
  content('Tts', '작별 인사', 23),
]

const MESSAGE =
  '도슨트 환영 장소 이동해서 1.인트로 발화하고 도슨트 안내 장소로 이동해서 2.TV 구조도 설명1 발화 해줘. 그리고 작별 인사하고 도슨트 대기 장소로 돌아오게 해줘'

describe('taskflow-nl-compose', () => {
  it('절 구분어가 없으면 문장 하나를 그대로 돌려준다', () => {
    expect(splitClauses('도슨트 환영 장소 이동', [])).toEqual(['도슨트 환영 장소 이동'])
  })

  it('복합 문장을 동작 순서대로 노드로 바꾼다', () => {
    const result = parseComposeNodesFromMessage(MESSAGE, TASKS, CONTENTS, RULES)

    expect(result.nodes).toEqual([
      { depth: 0, taskName: 'MoveTo', contentName: '도슨트 환영 장소' },
      { depth: 0, taskName: 'Tts', contentName: '1.인트로' },
      { depth: 0, taskName: 'MoveTo', contentName: '도슨트 안내 장소' },
      { depth: 0, taskName: 'Tts', contentName: '2.TV 구조도 설명1' },
      { depth: 0, taskName: 'Tts', contentName: '작별 인사' },
      { depth: 0, taskName: 'MoveTo', contentName: '도슨트 대기 장소' },
    ])
  })

  it('"돌아오게" 처럼 Task 표현이 겹쳐도 콘텐츠 이름이 있으면 그 Task 를 쓴다', () => {
    const result = parseComposeNodesFromMessage('도슨트 대기 장소로 돌아오게 해줘', TASKS, CONTENTS, RULES)

    expect(result.nodes).toEqual([{ depth: 0, taskName: 'MoveTo', contentName: '도슨트 대기 장소' }])
  })

  it('이름 뒤 괄호 코드는 호칭에서 빠져도 같은 노드로 본다', () => {
    const contents = [content('MoveTo', '도슨트 대기(D1)', 31), content('Tts', '1', 32)]
    const result = parseComposeNodesFromMessage('도슨트 대기 장소로 이동해줘', TASKS, contents, RULES)

    expect(result.nodes).toEqual([{ depth: 0, taskName: 'MoveTo', contentName: '도슨트 대기(D1)' }])
  })

  it('한 글자 콘텐츠 이름이 아무 문장에나 붙지 않는다', () => {
    const contents = [content('Tts', '1', 32)]
    const result = parseComposeNodesFromMessage('도슨트 대기 장소로 이동해줘', TASKS, contents, RULES)

    expect(result.nodes).toEqual([{ depth: 0, taskName: 'MoveTo' }])
  })

  it('호칭 접미어가 붙어도, 이름에 접미어가 있어도 같은 노드로 본다', () => {
    const contents = [
      content('MoveTo', '도슨트 대기(D1)', 31),
      content('PlayMotion', 'thumb_up', 41),
      content('PlayFace', 'Joy', 42),
    ]

    // 이름에 접미어가 없는데 사용자가 붙여 부르는 경우
    expect(parseComposeNodesFromMessage('도슨트 대기 장소로 이동해줘', TASKS, contents, RULES).nodes).toEqual([
      { depth: 0, taskName: 'MoveTo', contentName: '도슨트 대기(D1)' },
    ])
    expect(parseComposeNodesFromMessage('도슨트 대기 POI로 이동해줘', TASKS, contents, RULES).nodes).toEqual([
      { depth: 0, taskName: 'MoveTo', contentName: '도슨트 대기(D1)' },
    ])
    expect(parseComposeNodesFromMessage('thumb_up 모션 해줘', TASKS, contents, RULES).nodes).toEqual([
      { depth: 0, taskName: 'PlayMotion', contentName: 'thumb_up' },
    ])
    expect(parseComposeNodesFromMessage('Joy 얼굴 표시해줘', TASKS, contents, RULES).nodes).toEqual([
      { depth: 0, taskName: 'PlayFace', contentName: 'Joy' },
    ])
  })

  it('이름에 접미어가 포함돼 있으면 접미어 없이 불러도 찾는다', () => {
    const contents = [content('MoveTo', '도슨트 환영 장소', 11)]

    expect(parseComposeNodesFromMessage('도슨트 환영으로 이동해줘', TASKS, contents, RULES).nodes).toEqual([
      { depth: 0, taskName: 'MoveTo', contentName: '도슨트 환영 장소' },
    ])
  })

  it('콘텐츠를 못 찾으면 발화 표현으로 Task 만 정한다', () => {
    const result = parseComposeNodesFromMessage('없는 장소로 이동해줘', TASKS, CONTENTS, RULES)

    expect(result.nodes).toEqual([{ depth: 0, taskName: 'MoveTo' }])
  })
})
