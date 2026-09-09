import { ChatService } from '../service/chat.service'
import { ChatOrchestrator } from './chat.orchestrator'
import { IntentClassifier } from './intent.classifier'
import { getScreenConfig } from './screen-registry'
import { PromptStoreService } from '../features/chat/service/prompt-store.service'

describe('ChatOrchestrator taskflow routing guard', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const buildChatService = () => {
    const chatSetting = {
      get: jest.fn(async (key: string) => {
        const values: Record<string, string> = {
          'replyPolicy.infoEmptyText': '확인할 수 있는 정보가 부족해요.',
          'replyPolicy.defaultFallbackText': '요청을 처리했지만 답변 문장을 자연스럽게 만들지 못했어요. 같은 내용을 한 번 더 말씀해 주세요.',
          'replyPolicy.navigationFallbackText': '{path} 화면으로 이동을 준비했어요.',
          'replyPolicy.suggestedActionFallbackText': '요청을 처리했지만 안내 문장을 만들지 못했어요. 같은 내용을 한 번 더 말씀해 주세요.',
          'replyPolicy.unclearIntentFallbackText': '입력 내용을 정확히 이해하지 못했어요. 원하시는 작업이나 질문을 조금 더 구체적으로 알려주세요.',
          'replyPolicy.blockedReasonPhrases': '의도를 파악하기 어렵,입력된 내용이 불분명,분류는 반드시 json,confidence,reason',
        }
        return values[key] ?? ''
      }),
    }

    return new ChatService({} as any, chatSetting as any, {} as any)
  }

  const client = {
    generateContent: async () => ({ text: '' }),
  } as any

  const pipeline = {
    ragTopK: 3,
    maxToolTurns: 3,
    actionRunnerUrl: '',
    intentMinConfidence: 0.5,
  } as any

  // 규칙은 rule 테이블에서 온다. sql/20260907_1400_taskflow_rules_to_db.sql 의 값과 같게 둔다.
  const classifierRules = {
    explanationBlockKeywords: ['설명', '어떻게 쓰는지', '예시', '사용법'],
    nodeEditDeletePrefixes: ['삭제', '제거', '지우기', 'remove', 'delete'],
    arrowChainSeparators: ['->', '→', '=>', 'then', 'then->', 'and'],
    composeMoveHintKeywords: ['구성', '생성', '추가', '연결', '배치', '배열', '정렬', '다음', '이동', '연결해', '설계', '틀', '노드'],
    editSubjectKeywords: ['노드', 'taskflow', '태스크플로', '태스크 플로우', '플로우', '경로', '워크플로', '워크 플로우', 'flow'],
    editVerbKeywords: ['구성', '생성', '추가', '수정', '변경', '삭제', '제거', '연결', '배치', '정렬', '설정', '편집', '만들', '고치', '바꾸', '바꿔', '교체', '지워', '없애', '넣어', '빼줘', '빼고', '붙여', '이어'],
    arrowSequenceEnabled: false,
    explanationKeywords: ['설명', '예시', '사용법', '어떻게', '가이드'],
    composeRequestKeywords: ['구성해', '구성해줘', '만들어', '만들어줘', '작성해', '작성해줘', '설계해', '설계해줘', '추가해', '추가해줘', '연결해', '연결해줘'],
    explanationImageMinScore: 0,
    explanationImageMinScoreAlways: 0,
    concurrentHintKeywords: ['하면서', '하며', '동시에', '동시', '함께', '같이', '병렬', 'parallel'],
    actionRequestKeywords: [
      '해줘', '해 줘', '해주세요', '하게', '되게', '되도록', '하도록', '시켜', '시작해',
      '이동', '재생', '표시', '실행', '수행', '출력', '말해', '동작',
    ],
  } as any

  it('does not treat a Parallel usage question as a taskflow edit request', () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)

    expect((orchestrator as any).looksLikeTaskflowEditMessage('Parallel 노드는 어떻게 써?', classifierRules)).toBe(false)
    expect((orchestrator as any).looksLikeTaskflowEditMessage('Parallel 노드 구성해줘', classifierRules)).toBe(true)
  })

  it('treats concurrent action phrasing without an edit verb as a taskflow edit request', () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)

    expect((orchestrator as any).looksLikeTaskflowEditMessage(
      '도슨트 대기로 이동하면서, 이동 음악 재생하고, Joy 얼굴 표시되게 해줘',
      classifierRules,
      ['도슨트 대기', 'Joy'],
    )).toBe(true)
  })

  it('treats a multi-clause action sentence as a taskflow edit request even if a content name contains 설명', () => {
    const orchestrator = new ChatOrchestrator(client, 256, pipeline)
    // 룰 테이블 최신값(sql/20260909_ai_chat_taskflow_nl_compose.sql)과 같게 둔다.
    const rules = {
      ...classifierRules,
      explanationBlockKeywords: ['설명해줘', '설명해 줘', '설명 좀', '어떻게 쓰는지', '예시 알려', '사용법'],
      explanationKeywords: ['설명해줘', '설명해 줘', '설명 좀', '예시 알려', '사용법', '어떻게 쓰', '가이드 알려'],
      actionRequestKeywords: [...classifierRules.actionRequestKeywords, '발화', '인사', '돌아오게'],
    }

    expect((orchestrator as any).looksLikeTaskflowEditMessage(
      '도슨트 환영 장소 이동해서 1.인트로 발화하고 도슨트 안내 장소로 이동해서 2.TV 구조도 설명1 발화 해줘. 그리고 작별 인사하고 도슨트 대기 장소로 돌아오게 해줘',
      rules,
      ['도슨트 환영 장소', '1.인트로', '2.TV 구조도 설명1'],
    )).toBe(true)

    // 사용법 질문은 그대로 info 로 남아야 한다.
    expect((orchestrator as any).looksLikeTaskflowEditMessage('Parallel 노드 사용법 알려줘', rules, [])).toBe(false)
  })

  it('matches nothing when the rule table has no phrases for the screen', () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)

    expect((orchestrator as any).looksLikeTaskflowEditMessage('Parallel 노드 구성해줘')).toBe(false)
  })

  it('classifies only info or action and coerces legacy data to action', async () => {
    const classifier = new IntentClassifier({
      generateContent: async () => ({ text: '{"intent":"data","confidence":0.95}' }),
    } as any, 1024)

    await expect(classifier.classify('데이터를 보여줘', 'robot/test')).resolves.toMatchObject({
      intent: 'action',
      confidence: 0.95,
    })
  })

  it('stores structured rag payloads as JSON text and allows direct db reload', async () => {
    const ragRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        appKey: 'robot',
        screenKey: 'robot/ops',
        chunkKey: 'ops-overview',
        title: '운영 관제',
        keywords: ['운영', '관제'],
        body: '',
        imageUrl: null,
        intentType: 'both',
        enabled: true,
      }),
      save: jest.fn().mockImplementation(async (row) => row),
    }

    const store = new PromptStoreService({} as any, {} as any, {} as any, ragRepo as any)
    jest.spyOn(store, 'reload').mockResolvedValue(undefined)

    const payload = {
      title: '운영 관제',
      summary: '운영 관제는 TMS, CMS, SOTA, ROBOT 관리 기능을 함께 제공해요.',
      features: ['TMS 관리', 'CMS 관리', 'SOTA 관리', 'ROBOT 관리'],
      sections: [{ name: '기능', text: '운영 관제는 TMS, CMS, SOTA, ROBOT 관리 등의 기능을 제공한다.' }],
    }

    const updated = await store.updateRagChunk(7, { body: payload as any })

    expect(updated.body).toContain('운영 관제')
    expect(updated.body).toContain('TMS 관리')
    expect(updated.body).not.toContain('{\n  "title"')
    expect(ragRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('운영 관제'),
    }))
    expect((store as any).refreshFromDb).toBeDefined()
  })

  it('falls back to info when the action intent has no matching action RAG', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    const screen = {
      key: 'tms/taskflows/123/detail',
      appKey: 'tms',
      screenName: 'TaskFlow Detail',
      ragCollection: 'tms/taskflows/123/detail',
      dataTools: [],
      actionTools: [],
      commonActionTools: [],
      dataSystemPrompt: '',
      actionSystemPrompt: '',
      chatActions: { info: 'info', data: 'data', action: 'action' },
      fallbackText: 'fallback',
      guidanceExamples: [],
      intentClassifierPrompt: '',
    }

    jest.spyOn(require('../features/chat-settings/service/chat-setting.service'), 'getChatSettingService').mockReturnValue(null)
    jest.spyOn(require('./screen-registry'), 'getScreenConfig').mockReturnValue(screen as any)
    jest.spyOn((orchestrator as any).classifier, 'classify').mockResolvedValue({ intent: 'action', confidence: 1, reason: 'action' })
    jest.spyOn((orchestrator as any), 'retrieveActionRagContext').mockReturnValue({ context: '', usedChunks: [], ragScores: [] })
    const handleInfoSpy = jest.spyOn(orchestrator as any, 'handleInfo').mockResolvedValue({
      handled: true,
      reply: { chat_action: 'info', text: '정보 응답' },
      meta: { pipelineIntent: 'info' },
    })

    const result = await orchestrator.handle('tms/taskflows/123/detail', '배포 방법 알려줘', { reqId: 'req-action-fallback', history: [], screenTask: 'unknown' })

    expect(handleInfoSpy).toHaveBeenCalled()
    expect(result.reply?.chat_action).toBe('info')
    expect(result.reply?.text).toBe('정보 응답')
  })

  it('returns the configured final fallback text when no info RAG document matches', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    const screen = {
      key: 'robot/ops',
      appKey: 'robot',
      screenName: 'Operations',
      ragCollection: 'robot/ops',
      chatActions: { info: 'info', data: 'data', action: 'action' },
    }

    jest.spyOn(require('../features/chat-settings/service/chat-setting.service'), 'getChatSettingService').mockReturnValue({
      getFinalFallbackText: jest.fn().mockResolvedValue('등록된 안내에서 답변을 찾지 못했습니다.'),
    })
    jest.spyOn((orchestrator as any).rag, 'answer').mockResolvedValue({
      text: '',
      usedCollection: undefined,
      primaryChunkKey: undefined,
      usedChunks: [],
      ragScores: [],
    })

    const result = await (orchestrator as any).handleInfo(
      screen,
      '없는 정보 질문',
      {},
      { intent: 'info' },
      [],
      'unknown',
      ['robot/ops'],
      'req-final-fallback',
    )

    expect(result.reply.text).toBe('등록된 안내에서 답변을 찾지 못했습니다.')
    expect(result.meta.finalFallbackTextUsed).toBe(true)
  })

  it('skips the default LLM fallback when RAG has no usable answer', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    const screen = {
      key: 'robot/test',
      appKey: 'robot',
      screenName: '테스트 화면',
      ragCollection: 'robot/test',
      dataTools: [],
      actionTools: [],
      commonActionTools: [],
      dataSystemPrompt: '',
      actionSystemPrompt: '',
      chatActions: { info: 'info', data: 'data', action: 'action' },
      fallbackText: '기본 안내 문구',
      guidanceExamples: [],
      intentClassifierPrompt: '',
    }

    jest.spyOn(require('./screen-registry'), 'getScreenConfig').mockReturnValue(screen as any)
    jest.spyOn((orchestrator as any).rag, 'answer').mockResolvedValue({
      text: '',
      usedCollection: '',
      primaryChunkKey: '',
      usedChunks: [],
      ragScores: [],
    })
    const llmSpy = jest.spyOn(orchestrator as any, 'generateDefaultLlmReply').mockResolvedValue('llm fallback')

    const result = await (orchestrator as any).handleInfo(
      screen,
      '관련 정보를 알려줘',
      { actionKeywords: [], actionScreenTasks: [] },
      { intent: 'info', confidence: 0.7 },
      [],
      'unknown',
      ['robot/test'],
      'req-no-rag',
    )

    expect(llmSpy).not.toHaveBeenCalled()
    expect(result.reply?.text).toBe('')
  })

  it('includes chunk titles in the compact RAG warning log', () => {
    const logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn() }
    const service = buildChatService()
    ;(service as any).logger = logger
    ;(service as any).pipelineCfg = { infoRagMinScore: 0 }

    ;(service as any).emitCompactPipelineWarnLogs(
      { reqId: 'req-title-log', key: 'robot/test' } as any,
      { pipelineIntent: 'info' },
      {
        chat_action: 'info',
        text: '배포 방법을 설명합니다.',
        usedCollection: 'common',
        ragScores: [{
          collection: 'common',
          topScore: 11,
          adjustedScore: 11,
          hitCount: 1,
          topChunks: [{ chunkKey: 'chunk-1', title: '배포 가이드', finalScore: 11, rawScore: 9 }],
          topChunkIds: ['chunk-1'],
          relaxed: false,
        }],
      },
    )

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('배포 가이드'))
  })

  it('retries with common action tools before falling back', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)

    const run = jest.fn(async (_systemPrompt: string, _message: string, tools: Array<{ declaration: { name: string } }>) => {
      const toolNames = tools.map((tool) => tool.declaration.name)
      if (toolNames.includes('common-tool')) {
        return {
          text: '',
          executed: [
            {
              name: 'common-tool',
              args: {},
              result: {
                chat_action_param: {
                  via: 'common',
                  assistantText: '공통 action 성공',
                },
              },
            },
          ],
        }
      }

      return {
        text: '',
        executed: [
          {
            name: 'primary-tool',
            args: {},
            error: 'primary tool failed',
          },
        ],
      }
    })

    ;(orchestrator as any).agent = { run }

    const result = await (orchestrator as any).handleExecution(
      {
        key: 'robot/test',
        appKey: 'robot',
        screenName: '테스트 화면',
        ragCollection: 'robot/test',
        dataTools: [],
        actionTools: [
          {
            declaration: { name: 'primary-tool' },
            execute: async () => ({}),
          },
        ],
        commonActionTools: [
          {
            declaration: { name: 'common-tool' },
            execute: async () => ({}),
          },
        ],
        dataSystemPrompt: '',
        actionSystemPrompt: '',
        chatActions: { info: 'info', data: 'data', action: 'action' },
        fallbackText: 'fallback text',
      },
      '질문',
      { context: {}, body: { reqId: 'req-1' } } as any,
      {},
      [],
      'unknown',
      undefined,
      ['robot/test'],
      'req-1',
    )

    expect(run).toHaveBeenCalledTimes(2)
    expect(result.reply?.text).toContain('공통 action 성공')
    expect(result.meta).toMatchObject({ actionAttemptSource: 'common' })
  })

  it('falls back to the selected RAG chunk body when the model emits developer metadata JSON instead of the actual answer', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    const ragBody = '운영 관제는 TMS, CMS, SOTA, ROBOT 관리 등의 기능을 제공'

    const store = {
      getCollection: jest.fn((name) => ({
        chunks: [{ id: 'chunk-1', title: '운영 관제', body: ragBody, keywords: ['운영', '관제'] }],
      })),
    }
    jest.spyOn(require('../features/chat/service/prompt-store.service'), 'getPromptStore').mockReturnValue(store as any)

    expect((orchestrator as any).shouldUseRagBodyFallback('{"intent":"info","confidence":1.0,"reason":"운영 관제에 대한 개념 설명을 요청하는 질문입니다."}', ragBody)).toBe(true)
    expect((orchestrator as any).resolveUsedChunkBodyText(['common'], ['chunk-1'])).toBe(ragBody)
  })

  it('returns the screen fallback prompt when action intent has no tools', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    ;(orchestrator as any).rag = {
      scoreCollections: jest.fn(() => [{
        collection: 'tms/robots/:robotId/detail',
        topScore: 9,
        adjustedScore: 11,
        hitCount: 1,
        topChunks: [{ chunkKey: 'chunk-1', finalScore: 11, rawScore: 9 }],
        topChunkIds: ['chunk-1'],
        relaxed: false,
      }]),
      retrieve: jest.fn(() => [{
        chunk: { id: 'chunk-1', title: '배포 가이드', body: '로봇을 선택해 배포해 주세요.' },
        score: 9,
      }]),
      selection: { minScore: 0 },
    }

    ;(orchestrator as any).rag = {
      answer: jest.fn(async () => ({
        text: '화면별 가이드 문구',
        usedCollection: 'robot/test',
        usedChunks: [],
        ragScores: [],
      })),
      scoreCollections: jest.fn(() => []),
      retrieve: jest.fn(() => []),
    }

    const result = await (orchestrator as any).handleExecution(
      {
        key: 'robot/test',
        appKey: 'robot',
        screenName: '테스트 화면',
        ragCollection: 'robot/test',
        dataTools: [],
        actionTools: [],
        commonActionTools: [],
        dataSystemPrompt: '',
        actionSystemPrompt: '',
        chatActions: { info: 'info', data: 'data', action: 'action' },
        fallbackText: '화면별 가이드 문구',
        guidanceExamples: ['첫 번째 요청', '두 번째 요청'],
      },
      '처리해줘',
      { context: {}, body: { reqId: 'req-2' } } as any,
      {},
      [],
      'unknown',
      undefined,
      ['robot/test'],
      'req-2',
    )

    expect(result.reply).toEqual({
      chat_action: 'action',
      text: '화면별 가이드 문구',
    })
    expect(result.meta).toMatchObject({
      pipelineIntent: 'action',
      executed: [],
      fallbackTextUsed: false,
      actionRagCollection: 'robot/test',
      ragScores: [],
    })
  })

  it('ignores free-form agent text when no action tool was executed', async () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    ;(orchestrator as any).agent = {
      run: jest.fn(async () => ({ text: 'LLM이 임의로 만든 성공 응답', executed: [] })),
    }

    const result = await (orchestrator as any).handleExecution(
      {
        key: 'robot/test',
        appKey: 'robot',
        screenName: '테스트 화면',
        ragCollection: 'robot/test',
        dataTools: [],
        actionTools: [{ declaration: { name: 'screen-tool' }, execute: async () => ({}) }],
        commonActionTools: [],
        dataSystemPrompt: '',
        actionSystemPrompt: '',
        chatActions: { info: 'info', data: 'data', action: 'action' },
        fallbackText: '화면별 가이드 문구',
        guidanceExamples: ['첫 번째 요청', '두 번째 요청'],
      },
      '처리해줘',
      { context: {}, body: { reqId: 'req-3' } } as any,
      {},
      [],
      'unknown',
      undefined,
      ['robot/test'],
      'req-3',
    )

    expect(result.reply?.text).toBe('요청하신 작업을 확인하지 못했습니다. 어떤 항목을 어떻게 바꿀지 다시 한 번 구체적으로 말씀해 주세요.')
    expect(result.meta).toMatchObject({ pipelineIntent: 'action', fallbackTextUsed: true })
  })

  it('resolves a parameterized TMS detail route to its registered screen collection', async () => {
    const screenRepo = { find: jest.fn().mockResolvedValue([
      { appKey: 'tms', screenKey: 'tms/taskflows/:taskFlowId/detail', screenName: 'TaskFlow Detail', enabled: true },
      { appKey: 'tms', screenKey: 'tms/robots/:robotId/detail', screenName: 'Robot Detail', enabled: true },
    ]) }
    const migrationRepository = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    }
    const promptRepo = {
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn(async (run) => run({ getRepository: () => migrationRepository })),
      },
    }
    const guidanceRepo = { find: jest.fn().mockResolvedValue([]) }
    const ragRepo = { find: jest.fn().mockResolvedValue([]) }

    const store = new PromptStoreService(screenRepo as any, promptRepo as any, guidanceRepo as any, ragRepo as any)
    await store.onModuleInit()

    expect(getScreenConfig('tms/taskflows/197/detail')).toMatchObject({
      key: 'tms/taskflows/:taskFlowId/detail',
      appKey: 'tms',
      ragCollection: 'tms/taskflows/:taskFlowId/detail',
    })
    expect(getScreenConfig('tms/robots/y1xF6coSjREkJ1trnvw/detail')).toMatchObject({
      key: 'tms/robots/:robotId/detail',
      appKey: 'tms',
      ragCollection: 'tms/robots/:robotId/detail',
    })
  })

  it('loads app-level rag collections under both screenKey and appKey aliases', async () => {
    const screenRepo = { find: jest.fn().mockResolvedValue([]) }
    const migrationRepository = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    }
    const promptRepo = {
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn(async (run) => run({ getRepository: () => migrationRepository })),
      },
    }
    const guidanceRepo = { find: jest.fn().mockResolvedValue([]) }
    const ragRepo = { find: jest.fn().mockResolvedValue([
      {
        appKey: 'tms',
        screenKey: 'tms',
        chunkKey: 'deploy-guide',
        title: 'TMS 배포 가이드',
        keywords: ['배포', 'tms'],
        body: '배포 방법을 설명합니다.',
        imageUrl: null,
        intentType: 'info',
        enabled: true,
      },
      {
        appKey: 'common',
        screenKey: 'common',
        chunkKey: 'ops-guide',
        title: '운영 가이드',
        keywords: ['운영', '관제'],
        body: '운영 관제는 무엇인가',
        imageUrl: null,
        intentType: 'info',
        enabled: true,
      },
    ]) }

    const store = new PromptStoreService(screenRepo as any, promptRepo as any, guidanceRepo as any, ragRepo as any)
    await store.onModuleInit()

    expect(store.getCollection('tms')).toMatchObject({ key: 'tms' })
    expect(store.getCollection('common')).toMatchObject({ key: 'common' })
    expect(store.getCollection('tms')?.chunks[0]).toMatchObject({ id: 'deploy-guide' })
    expect(store.getCollection('common')?.chunks[0]).toMatchObject({ id: 'ops-guide' })
  })

  it('treats empty intentType as eligible for both info and action to preserve legacy/common RAG rows', () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    const rag = (orchestrator as any).rag

    expect((rag as any).supportsIntent({ intentType: undefined }, 'info')).toBe(true)
    expect((rag as any).supportsIntent({ intentType: undefined }, 'action')).toBe(true)
    expect((rag as any).supportsIntent({ intentType: 'info' }, 'info')).toBe(true)
    expect((rag as any).supportsIntent({ intentType: 'action' }, 'action')).toBe(true)
    expect((rag as any).supportsIntent({ intentType: 'action' }, 'info')).toBe(false)
  })

  it('scores only action-type RAG when the classified intent is action', () => {
    const orchestrator = new ChatOrchestrator(client, 1024, pipeline, { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any)
    const rag = (orchestrator as any).rag

    const actionOnly = rag.scoreCollections(['tms'], '배포해줘', 'action')
    expect(actionOnly).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: 'tms' }),
    ]))

    const infoOnly = rag.scoreCollections(['tms'], '배포해줘', 'info')
    expect(infoOnly).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: 'tms' }),
    ]))
  })

  it('preserves app action RAG metadata for the saved chat log trace', async () => {
    const chatLog = { save: jest.fn().mockResolvedValue(undefined) }
    const service = new (require('./../service/chat.service').ChatService)(chatLog, {}, {})

    const orchestrator = {
      handle: jest.fn().mockResolvedValue({
        handled: true,
        reply: { chat_action: 'action', text: '처리했습니다.' },
        meta: {
          pipelineIntent: 'action',
          actionRagCollection: 'robot/ailog',
          actionRagChunks: ['rag-1', 'rag-2'],
        },
      }),
    }

    const ctx = {
      body: { message: '앱별 액션 RAG를 확인해줘', currentApp: 'robot', currentPath: '/robot/ailog' },
      reqId: 'req-action-rag',
      llm: {} as any,
      orchestrator,
      startedAt: Date.now(),
      author: 'tester',
      conversationId: 'conv-1',
      message: '앱별 액션 RAG를 확인해줘',
      currentApp: 'robot',
      currentPath: '/robot/ailog',
      key: 'robot/ailog',
      history: [],
      taskflowClassifierRules: {},
    }

    const saveLogSpy = jest.spyOn(service as any, 'saveLog').mockResolvedValue(undefined)
    ;(service as any).emitCompactPipelineWarnLogs = jest.fn()
    ;(service as any).buildOrchestratorPipelineTrace = jest.fn(() => 'trace')
    ;(service as any).extractPipelineConfidence = jest.fn(() => 0.9)
    ;(service as any).attachPipelineTrace = jest.fn((reply) => reply)
    ;(service as any).ensurePeriodInEventReply = jest.fn((reply) => reply)

    await (service as any).runOrchestrator(ctx, 'run_action')

    const debugMeta = saveLogSpy.mock.calls[0][3]
    expect(debugMeta).toMatchObject({
      pipelineIntent: 'action',
      usedCollection: 'robot/ailog',
      actionRagCollection: 'robot/ailog',
      usedChunks: ['rag-1', 'rag-2'],
      actionRagChunks: ['rag-1', 'rag-2'],
    })
  })
})
