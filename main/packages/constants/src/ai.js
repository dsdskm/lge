export const FRONT_GRAPH_RULE_TYPE = 'front-graph-rule'

export const TMS_APP_KEY = 'tms'
export const TMS_TASKFLOW_DETAIL_ROUTE_KEY = 'tms/taskflows/:taskFlowId/detail'
export const TASKFLOW_CANVAS_RULE_ROUTE_KEY = 'tms/taskflows/:taskFlowId/canvas'

export const AI_TASKFLOW_CANVAS_DRAFT_EVENT = 'ai-assistant:taskflow-canvas-draft'
export const AI_TASKFLOW_CANVAS_CLARIFY_EVENT = 'ai-assistant:taskflow-canvas-clarify'
export const AI_TASKFLOW_CANVAS_COMMAND_EVENT = 'ai-assistant:taskflow-canvas-command'
export const AI_TASKFLOW_CANVAS_RESULT_EVENT = 'ai-assistant:taskflow-canvas-result'
export const AI_TASKFLOW_REFRESH_CONTENTS_EVENT = 'ai-assistant:taskflow-refresh-contents'

// 서버가 지시하는 "약속된 함수" 이름. action_tool.client_function 값과 같은 문자열이어야 한다.
// LLM 함수(action_tool.llm_function)와 이름을 맞춰 둔다. 어느 도구의 결과인지 이름만 보고 알 수 있다.
export const CLIENT_ACTION = {
  COMPOSE_LINEAR_TASKFLOW: 'compose_linear_taskflow',
  EDIT_TASKFLOW: 'edit_taskflow'
}

// node-*.js 액션의 command.type은 RULE_KEY.NODE_* 값을 그대로 재사용한다.
export const TASKFLOW_CANVAS_COMMAND_TYPE = {
  SAVE: 'save',
  SET_FLOW_MODE: 'set-flow-mode',
  ALIGN: 'align'
}

export const RULE_KEY = {
  TMS_HELP: 'tms-help',
  TASKFLOW_LIST: 'taskflow-list',
  TASKFLOW_DETAIL: 'taskflow-detail',
  ROBOT_LIST: 'robot-list',
  ROBOT_DETAIL: 'robot-detail',
  TASKFLOW_CREATE: 'taskflow-create',
  TASKFLOW_EDIT: 'taskflow-edit',
  TASKFLOW_COPY: 'taskflow-copy',
  TASKFLOW_DELETE: 'taskflow-delete',
  TASKFLOW_DEPLOY: 'taskflow-deploy',
  TASKFLOW_RUN: 'taskflow-run',
  TASKFLOW_PAUSE: 'taskflow-pause',
  TASKFLOW_RESUME: 'taskflow-resume',
  TASKFLOW_STOP: 'taskflow-stop',
  NODE_SAVE_FINAL: 'node-save-final',
  NODE_SAVE_TEMP: 'node-save-temp',
  NODE_CLEAR_ALL: 'node-clear-all',
  NODE_UNDO: 'node-undo',
  NODE_REDO: 'node-redo',
  NODE_RESET: 'node-reset',
  NODE_CONTENTS_REFRESH: 'node-contents-refresh',
  NODE_CREATE_HORIZON: 'node-create-horizon',
  NODE_APPEND_HORIZON: 'node-append-horizon',
  NODE_CREATE_VERTICAL: 'node-create-vertical',
  NODE_APPEND_VERTICAL: 'node-append-vertical',
  NODE_DELETE: 'node-delete',

  // robot 앱 화면 이동 명령 (AI Assistant Rule 탭에서 등록, extraJson.navigation 경로로 이동)
  ROBOT_APP_DASHBOARD: 'robot-app-dashboard',
  ROBOT_APP_MANAGEMENT_LIST: 'robot-app-management-list',
  ROBOT_APP_MAP_LIST: 'robot-app-map-list',
  ROBOT_APP_GROUP_LIST: 'robot-app-group-list',
  ROBOT_APP_USER_LIST: 'robot-app-user-list',
  ROBOT_APP_TERM_LIST: 'robot-app-term-list',

  // robot 앱 이름 기반 상세 이동 (기존 로봇/사이트 목록 API로 이름→ID 조회 후 이동)
  ROBOT_APP_MANAGEMENT_DETAIL: 'robot-app-management-detail',
  ROBOT_APP_SITE_DETAIL: 'robot-app-site-detail',

  // robot 앱 로그 리플레이 (사이트+로봇명으로 조회 후 새 창 열기)
  ROBOT_LOGREPLAY_DRIVING_BY_NAME: 'robot-logreplay-driving-by-name',
  ROBOT_LOGREPLAY_MANIPULATION_BY_NAME: 'robot-logreplay-manipulation-by-name'
}

// ── AI Assistant 회귀 테스트(임시) ───────────────────────────────────────────
// AI Assistant 헤더의 Test 버튼이 한 번 누를 때 한 케이스씩 실행한다(<, > 로 순번 이동).
// 케이스마다 Start 노드만 남기고 캔버스를 비운 뒤 시작한다.
//
// 노드 이름은 코드에 박지 않는다. slots 에 "어떤 Task 의 몇 번째 콘텐츠" 만 적고,
// 문장·기대값에서는 {{슬롯}} 으로 쓴다. 실행 직전에 캔버스 팔레트의 실제 이름으로 채워진다.
//  - slots.<이름> = { task, index, kind, transform }
//      task      : 팔레트 Task 이름(PlayFace, Tts, MoveTo, PlayMotion, PlaySound ...)
//      index     : 그 Task 의 몇 번째 콘텐츠(콘텐츠 id 순, 기본 0)
//      kind      : 'task' 면 Task 이름 자체를 쓴다(Pause 처럼 콘텐츠가 없는 Task)
//      transform : 이름의 모양이 시험 대상일 때 — stripSuffix / stripLeadingIndex / typo
//  - 필요한 콘텐츠가 팔레트에 없으면 그 케이스는 Skip 으로 표시된다.
//
// setup  : 판정 전에 기준 노드를 만드는 문장(판정 대상 아님)
// expect : nodes / absent / childOf / nextOf / props / aliasTask (판정은 캔버스 노드·엣지로만 한다)
export const AI_TASKFLOW_TEST_CASES = [
  {
    key: 'T01-add-tail',
    title: '이름 그대로 추가',
    slots: { face1: { task: 'PlayFace', index: 0 } },
    message: '{{face1}} 얼굴 추가해줘',
    expect: { nodes: [{ name: '{{face1}}' }] }
  },
  {
    key: 'T02-suffix-name',
    title: '접미어 차이 이름 보정',
    slots: {
      poi1: { task: 'MoveTo', index: 0 },
      poi1Loose: { task: 'MoveTo', index: 0, transform: 'stripSuffix' }
    },
    message: '{{poi1Loose}}로 이동해줘',
    expect: { nodes: [{ name: '{{poi1}}' }] }
  },
  {
    key: 'T03-task-word-in-name',
    title: 'Task 표현이 섞인 이름',
    slots: {
      tts1: { task: 'Tts', index: 0 },
      tts1Loose: { task: 'Tts', index: 0, transform: 'stripLeadingIndex' }
    },
    message: '{{tts1Loose}} 음성 추가해줘',
    expect: { nodes: [{ name: '{{tts1}}' }] }
  },
  {
    key: 'T04-sequence',
    title: '순차 두 단계',
    slots: { face1: { task: 'PlayFace', index: 0 }, poi1: { task: 'MoveTo', index: 0 } },
    message: '{{face1}} 얼굴 보여주고 {{poi1}}로 이동해줘',
    expect: { nextOf: [{ from: '{{face1}}', to: '{{poi1}}' }] }
  },
  {
    key: 'T05-parallel-compose',
    title: '동시 실행 제어 노드 구성',
    slots: {
      tts1: { task: 'Tts', index: 0 },
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 }
    },
    message: '{{tts1}} tts, {{motion1}} 모션, {{face1}} 얼굴을 동시에 수행하는 parallel을 만들어줘',
    expect: {
      nodes: [{ name: 'Parallel' }],
      childOf: [{ parent: 'Parallel', children: ['{{tts1}}', '{{motion1}}', '{{face1}}'] }]
    }
  },
  {
    key: 'T06-parallel-duplicate-task',
    title: 'Parallel 같은 Task 중복 제외',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      tts1: { task: 'Tts', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      face2: { task: 'PlayFace', index: 1 },
      face3: { task: 'PlayFace', index: 2 }
    },
    setup: ['{{motion1}} 모션과 {{tts1}} tts를 동시에 수행하는 parallel을 만들어줘'],
    message: 'parallel 아래에 {{face1}}, {{face2}}, {{face3}} 추가해줘',
    expect: {
      childOf: [{ parent: 'Parallel', children: ['{{face1}}'] }],
      absent: ['{{face2}}', '{{face3}}']
    }
  },
  {
    key: 'T07-attach-right',
    title: '제어 노드 우측(다음 순서)에 추가',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      tts2: { task: 'Tts', index: 1 }
    },
    setup: ['{{motion1}} 모션과 {{face1}} 얼굴을 동시에 수행하는 parallel을 만들어줘'],
    message: 'parallel 우측에 {{tts2}} 추가해줘',
    expect: { nextOf: [{ from: 'Parallel', to: '{{tts2}}' }] }
  },
  {
    key: 'T08-ifthenelse',
    title: '조건 분기 구성',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      face2: { task: 'PlayFace', index: 1 }
    },
    message:
      '{{motion1}} 모션 성공하면 {{face1}} 얼굴, 실패하면 {{face2}} 얼굴 보이게 하는 ifThenElse 노드를 만들어줘',
    expect: {
      nodes: [{ name: 'IfThenElse' }],
      childOf: [{ parent: 'IfThenElse', children: ['{{motion1}}', '{{face1}}', '{{face2}}'] }]
    }
  },
  {
    key: 'T09-repeat-and-next',
    title: '반복 + 후속 동작',
    slots: { face1: { task: 'PlayFace', index: 0 }, poi1: { task: 'MoveTo', index: 0 } },
    message: '{{face1}} 얼굴 3회 반복하고 {{poi1}}로 이동해줘',
    expect: {
      childOf: [{ parent: 'Repeat', children: ['{{face1}}'] }],
      nextOf: [{ from: 'Repeat', to: '{{poi1}}' }],
      props: [{ name: 'Repeat', key: 'num_cycles', value: 3 }]
    }
  },
  {
    key: 'T10-replace',
    title: '노드 교체',
    slots: { face1: { task: 'PlayFace', index: 0 }, face2: { task: 'PlayFace', index: 1 } },
    setup: ['{{face1}} 얼굴 추가해줘'],
    message: '{{face1}}를 {{face2}}로 바꿔줘',
    expect: { nodes: [{ name: '{{face2}}' }], absent: ['{{face1}}'] }
  },
  {
    key: 'T11-delay-and-next',
    title: '지연 + 후속 동작',
    slots: { face1: { task: 'PlayFace', index: 0 }, tts2: { task: 'Tts', index: 1 } },
    message: '3초 기다렸다가 {{face1}} 얼굴 보여주고 {{tts2}} 발화해줘',
    expect: {
      childOf: [{ parent: 'Delay', children: ['{{face1}}'] }],
      nextOf: [{ from: 'Delay', to: '{{tts2}}' }],
      props: [{ name: 'Delay', key: 'delay_msec', value: 3000 }]
    }
  },
  {
    key: 'T12-remove',
    title: '노드 삭제',
    slots: { face1: { task: 'PlayFace', index: 0 } },
    setup: ['{{face1}} 얼굴 추가해줘'],
    message: '{{face1}} 노드 지워줘',
    expect: { absent: ['{{face1}}'] }
  },
  {
    key: 'T13-long-sequence',
    title: '여러 단계 순차',
    slots: {
      poi1: { task: 'MoveTo', index: 0 },
      tts1: { task: 'Tts', index: 0 },
      tts2: { task: 'Tts', index: 1 }
    },
    message: '{{poi1}}로 이동해서 {{tts1}} 발화하고 {{tts2}} 발화해줘',
    expect: {
      nextOf: [
        { from: '{{poi1}}', to: '{{tts1}}' },
        { from: '{{tts1}}', to: '{{tts2}}' }
      ]
    }
  },
  {
    key: 'T14-concurrent-conjunction',
    title: '접속어로 표현한 동시 실행',
    slots: { poi1: { task: 'MoveTo', index: 0 }, sound1: { task: 'PlaySound', index: 0 } },
    message: '{{poi1}}로 이동하면서 {{sound1}} 틀어줘',
    expect: {
      nodes: [{ name: 'Parallel' }],
      childOf: [{ parent: 'Parallel', children: ['{{poi1}}', '{{sound1}}'] }]
    }
  },
  {
    key: 'T15-timeout',
    title: '타임아웃',
    slots: { face1: { task: 'PlayFace', index: 0 } },
    message: '{{face1}} 얼굴 실행하고 3초 타임아웃 걸어줘',
    expect: {
      childOf: [{ parent: 'Timeout', children: ['{{face1}}'] }],
      props: [{ name: 'Timeout', key: 'delay_msec', value: 3000 }]
    }
  },
  {
    key: 'T16-set-property',
    title: '속성 변경',
    slots: { face1: { task: 'PlayFace', index: 0 } },
    setup: ['{{face1}} 얼굴 3회 반복해줘'],
    message: 'Repeat 반복횟수 5로 바꿔줘',
    expect: {
      childOf: [{ parent: 'Repeat', children: ['{{face1}}'] }],
      props: [{ name: 'Repeat', key: 'num_cycles', value: 5 }]
    }
  },
  {
    key: 'T17-two-edits-one-sentence',
    title: '한 문장에 수정 두 건',
    slots: { face1: { task: 'PlayFace', index: 0 }, face2: { task: 'PlayFace', index: 1 } },
    // "3초 기다려줘" 만 말하면 Wait 노드가 생긴다. Delay 는 뒤 동작에 지연을 거는 제어 노드라
    // 속성을 바꿀 대상이 생기도록 준비 문장을 둘로 나눈다.
    setup: ['{{face1}} 얼굴 3회 반복해줘', '3초 기다렸다가 {{face2}} 얼굴 보여줘'],
    message: 'Repeat 반복횟수 5로 바꾸고 Delay 시간을 2초로 바꿔줘',
    expect: {
      props: [
        { name: 'Repeat', key: 'num_cycles', value: 5 },
        { name: 'Delay', key: 'delay_msec', value: 2000 }
      ]
    }
  },
  {
    key: 'T18-ordinal-target',
    title: '순번 지목 + 노드 추가',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      tts1: { task: 'Tts', index: 0 },
      sound1: { task: 'PlaySound', index: 0 },
      poi1: { task: 'MoveTo', index: 0 }
    },
    setup: [
      '{{motion1}} 모션과 {{face1}} 얼굴을 동시에 수행하는 parallel을 만들어줘',
      'parallel 우측에 {{tts1}} tts와 {{sound1}}을 동시에 수행하는 parallel을 만들어줘'
    ],
    message: '두번째 parallel 아래에 {{poi1}} 추가해줘',
    expect: {
      nodes: [{ name: 'Parallel', count: 2 }],
      childOf: [{ parent: 'Parallel', children: ['{{tts1}}', '{{sound1}}', '{{poi1}}'] }]
    }
  },
  {
    key: 'T19-typo',
    title: '오타 보정',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      pauseTypo: { task: 'Pause', kind: 'task', transform: 'typo' }
    },
    setup: ['{{motion1}} 모션과 {{face1}} 얼굴을 동시에 수행하는 parallel을 만들어줘'],
    message: 'parallel 아래에 {{pauseTypo}} 추가해줘',
    expect: { childOf: [{ parent: 'Parallel', children: ['Pause'] }] }
  },
  {
    key: 'T20-name-vs-action-word',
    title: '이름이 동작 표현과 같은 경우',
    slots: { poi1: { task: 'MoveTo', index: 0 }, sound1: { task: 'PlaySound', index: 0 } },
    message: '{{poi1}}로 이동해줘',
    expect: { nodes: [{ name: '{{poi1}}' }], absent: ['{{sound1}}'] }
  },
  {
    key: 'T21-control-and-sequence',
    title: '제어 노드 + 순차 혼합',
    slots: {
      face1: { task: 'PlayFace', index: 0 },
      tts1: { task: 'Tts', index: 0 },
      tts2: { task: 'Tts', index: 1 }
    },
    message: '{{face1}} 얼굴과 {{tts1}} tts를 동시에 실행하고 {{tts2}} 발화해줘',
    expect: {
      childOf: [{ parent: 'Parallel', children: ['{{face1}}', '{{tts1}}'] }],
      nextOf: [{ from: 'Parallel', to: '{{tts2}}' }]
    }
  },
  {
    key: 'T22-remove-middle',
    title: '중간 노드 삭제 후 이어붙기',
    slots: {
      face1: { task: 'PlayFace', index: 0 },
      poi1: { task: 'MoveTo', index: 0 },
      tts2: { task: 'Tts', index: 1 }
    },
    setup: ['{{face1}} 얼굴 보여주고 {{poi1}}로 이동하고 {{tts2}} 발화해줘'],
    message: '{{poi1}} 노드 지워줘',
    expect: {
      absent: ['{{poi1}}'],
      nextOf: [{ from: '{{face1}}', to: '{{tts2}}' }]
    }
  },
  {
    key: 'T23-five-step-sequence',
    title: '노드 5개 순차 구성',
    slots: {
      poi1: { task: 'MoveTo', index: 0 },
      tts1: { task: 'Tts', index: 0 },
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      tts2: { task: 'Tts', index: 1 }
    },
    message:
      '{{poi1}}로 이동해서 {{tts1}} 발화하고 {{motion1}} 모션 보여주고 {{face1}} 얼굴 띄운 다음 {{tts2}} 발화해줘',
    expect: {
      nextOf: [
        { from: '{{poi1}}', to: '{{tts1}}' },
        { from: '{{tts1}}', to: '{{motion1}}' },
        { from: '{{motion1}}', to: '{{face1}}' },
        { from: '{{face1}}', to: '{{tts2}}' }
      ]
    }
  },
  {
    key: 'T24-parallel-four-children',
    title: '동시 실행 자식 4개',
    slots: {
      tts1: { task: 'Tts', index: 0 },
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      sound1: { task: 'PlaySound', index: 0 }
    },
    message: '{{tts1}} tts, {{motion1}} 모션, {{face1}} 얼굴, {{sound1}}을 동시에 수행하는 parallel을 만들어줘',
    expect: {
      nodes: [{ name: 'Parallel' }],
      childOf: [{ parent: 'Parallel', children: ['{{tts1}}', '{{motion1}}', '{{face1}}', '{{sound1}}'] }]
    }
  },
  {
    key: 'T25-parallel-then-two-steps',
    title: '동시 실행 3개 + 후속 2단',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      sound1: { task: 'PlaySound', index: 0 },
      poi1: { task: 'MoveTo', index: 0 },
      tts2: { task: 'Tts', index: 1 }
    },
    message:
      '{{motion1}} 모션과 {{face1}} 얼굴과 {{sound1}}을 동시에 실행하고 {{poi1}}로 이동한 뒤 {{tts2}} 발화해줘',
    expect: {
      childOf: [{ parent: 'Parallel', children: ['{{motion1}}', '{{face1}}', '{{sound1}}'] }],
      nextOf: [
        { from: 'Parallel', to: '{{poi1}}' },
        { from: '{{poi1}}', to: '{{tts2}}' }
      ]
    }
  },
  {
    key: 'T26-ifthenelse-then-next',
    title: '조건 분기 3개 + 후속 동작',
    slots: {
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      face2: { task: 'PlayFace', index: 1 },
      poi1: { task: 'MoveTo', index: 0 }
    },
    message:
      '{{motion1}} 모션 성공하면 {{face1}} 얼굴, 실패하면 {{face2}} 얼굴 보이게 하고 그 다음 {{poi1}}로 이동해줘',
    expect: {
      childOf: [{ parent: 'IfThenElse', children: ['{{motion1}}', '{{face1}}', '{{face2}}'] }],
      nextOf: [{ from: 'IfThenElse', to: '{{poi1}}' }]
    }
  },
  {
    key: 'T27-multi-edit-on-five-nodes',
    title: '5개 흐름에서 교체 + 삭제 동시 요청',
    slots: {
      poi1: { task: 'MoveTo', index: 0 },
      tts1: { task: 'Tts', index: 0 },
      motion1: { task: 'PlayMotion', index: 0 },
      face1: { task: 'PlayFace', index: 0 },
      face2: { task: 'PlayFace', index: 1 },
      tts2: { task: 'Tts', index: 1 }
    },
    setup: [
      '{{poi1}}로 이동해서 {{tts1}} 발화하고 {{motion1}} 모션 보여주고 {{face1}} 얼굴 띄운 다음 {{tts2}} 발화해줘'
    ],
    message: '{{face1}}를 {{face2}}로 바꾸고 {{motion1}} 노드 지워줘',
    expect: {
      nodes: [{ name: '{{face2}}' }],
      absent: ['{{face1}}', '{{motion1}}'],
      nextOf: [
        { from: '{{tts1}}', to: '{{face2}}' },
        { from: '{{face2}}', to: '{{tts2}}' }
      ]
    }
  }
]
