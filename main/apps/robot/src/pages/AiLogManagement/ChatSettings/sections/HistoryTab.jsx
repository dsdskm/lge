import { useMemo, useState } from 'react'

import {
  SettingCard,
  CardHeader,
  CardTitle,
  SectionTitleRow,
  SmallBadge,
  PageDescription,
  HistoryList,
  HistoryCard,
  HistoryMeta,
  HistoryMessage,
  DebugSummaryBar,
  DebugChip,
  DebugGrid,
  DebugMetricCard,
  DebugMetricLabel,
  DebugMetricValue,
  DebugDetailPanel,
  DebugDetailTitle,
  DebugMonoBlock,
  PrimaryButton,
  ModalBackdrop,
  ModalCard,
  ModalTitle,
  ModalDescription,
  ModalActions
} from '../styles'

import { formatDateTime } from '../chatSettings.utils'

const toDebugMeta = (item) => {
  const raw = item?.debugMeta
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

const formatScore = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(2)
}

const toFiniteNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const summarizeLoginUser = (debugMeta, item) => {
  const loginUser = debugMeta?.loginUser && typeof debugMeta.loginUser === 'object' ? debugMeta.loginUser : {}

  const userId = String(loginUser?.userId ?? item?.author ?? '').trim()
  const userEmail = String(loginUser?.userEmail ?? '').trim()
  const accountId = String(loginUser?.accountId ?? '').trim()

  return {
    userId,
    userEmail,
    accountId
  }
}

const resolveDisplayEmail = (loginUser, item) => {
  const email = String(loginUser?.userEmail ?? '').trim()
  if (email) return email
  return String(item?.author ?? '').trim() || '-'
}

const normalizeChunkKeys = (value) => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

const summarizeDebugIntent = (intent, confidence) => {
  const labelMap = {
    info: '정보형 질문으로 판단',
    action: '실행형 요청으로 판단',
    data: '조회형 요청으로 판단'
  }
  const summary =
    labelMap[
      String(intent ?? '')
        .trim()
        .toLowerCase()
    ] ?? '분류 정보 없음'
  const conf = Number.isFinite(confidence) ? confidence.toFixed(2) : '-'
  return `${summary} (신뢰도 ${conf})`
}

const resolveRuleMatchStage = (source) => {
  const normalized = String(source ?? '').trim()
  if (normalized === 'rule-first') return '3단계: 룰우선처리(event-rule-first)'
  if (normalized === 'front-rule') return '4단계: front-rule-engine'
  if (normalized === 'orchestrator') return '4-4단계: 오케스트레이터'
  if (normalized === 'guidance') return '5단계: 가이던스 폴백'
  return '매칭 단계 정보 없음'
}

const formatFlowSteps = ({
  trace,
  matchedRuleKey,
  source,
  ruleDisplayText,
  matchedRuleConfidence,
  matchedRuleReason
}) => {
  const normalizedTrace = String(trace ?? '').trim()
  const rawSteps = normalizedTrace
    ? normalizedTrace
        .split('=>')
        .map((step) => String(step ?? '').trim())
        .filter(Boolean)
    : ['응답 흐름 정보 없음']

  const numberedSteps = rawSteps.map((step, index) => `${index + 1}. ${step}`)

  if (matchedRuleKey) {
    const ruleLine = [
      `rule: ${ruleDisplayText}`,
      matchedRuleConfidence !== undefined ? `confidence ${matchedRuleConfidence.toFixed(2)}` : '',
      matchedRuleReason || ''
    ]
      .filter(Boolean)
      .join(' · ')

    return ['[Flow]', ...numberedSteps, '', '[Rule Match]', `stage: ${resolveRuleMatchStage(source)}`, ruleLine].join(
      '\n'
    )
  }

  return ['[Flow]', ...numberedSteps].join('\n')
}

const STEP_TONE = {
  ok: 'green',
  skip: 'slate',
  fallback: 'amber',
  fail: 'rose'
}

const toFlowTrace = (debugMeta) => {
  const raw = debugMeta?.flowTrace
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const decisions = raw?.decisions && typeof raw.decisions === 'object' ? raw.decisions : {}
  const steps = Array.isArray(raw?.steps) ? raw.steps : []

  return {
    reqId: String(raw?.reqId ?? '').trim(),
    route: String(raw?.route ?? '').trim(),
    totalMs: Number.isFinite(Number(raw?.totalMs)) ? Number(raw.totalMs) : undefined,
    decisions,
    steps
  }
}

const RAG_ROLE_LABEL = {
  answer: '답변 근거',
  context: '도구 프롬프트 참고',
  unused: '미사용'
}

/** RAG 가 어떻게 쓰였는지. action 경로의 RAG 는 답변이 아니라 도구 프롬프트에 붙는 참고 문서다. */
const resolveRagRole = (decisions, debugMeta) => {
  const role = String(decisions?.ragRole ?? '').trim()
  if (RAG_ROLE_LABEL[role]) return role
  if (String(debugMeta?.pipelineIntent ?? '').trim() === 'action') return 'context'
  return decisions?.ragUsed || debugMeta?.usedChunks?.length > 0 ? 'answer' : 'unused'
}

/** 판단 결과를 한 줄 칩으로. 룰 매칭인지 / RAG 인지 / info·action 인지 / 점수는 얼마인지를 여기서 읽는다. */
const FlowDecisionChips = ({ decisions }) => (
  <DebugSummaryBar>
    <DebugChip $tone={decisions?.ruleMatched ? 'green' : 'slate'}>
      룰: {decisions?.ruleMatched ? '매칭' : decisions?.ruleEvaluated ? '미매칭' : '평가 안 함'}
    </DebugChip>
    <DebugChip $tone="blue">
      의도: {String(decisions?.intent ?? '-')} ({formatScore(decisions?.intentConfidence)})
    </DebugChip>
    <DebugChip $tone="slate">의도 결정: {String(decisions?.intentSource ?? '-')}</DebugChip>
    <DebugChip $tone="amber">처리 경로: {String(decisions?.handler ?? '-')}</DebugChip>
    <DebugChip $tone={decisions?.ragRole === 'answer' ? 'green' : decisions?.ragRole === 'context' ? 'amber' : 'slate'}>
      RAG {RAG_ROLE_LABEL[String(decisions?.ragRole ?? '')] ?? '판정 없음'}
      {decisions?.ragUsedCollection ? `: ${decisions.ragUsedCollection}` : ''}
    </DebugChip>
    <DebugChip $tone="slate">
      RAG 점수: {formatScore(decisions?.ragTopScore)} / 기준 {formatScore(decisions?.ragMinScore)}
    </DebugChip>
    {Array.isArray(decisions?.ruleKeys) && decisions.ruleKeys.length > 0 ? (
      <DebugChip $tone="green">rule_key: {decisions.ruleKeys.join(' + ')}</DebugChip>
    ) : null}
    {Array.isArray(decisions?.toolCalls) && decisions.toolCalls.length > 0 ? (
      <DebugChip $tone="blue">tool: {decisions.toolCalls.join(', ')}</DebugChip>
    ) : null}
  </DebugSummaryBar>
)

const formatStepDetail = (detail) => {
  if (!detail || typeof detail !== 'object') return ''
  return Object.entries(detail)
    .filter(([key]) => key !== 'status')
    .map(([key, value]) => `${key}=${String(value ?? '')}`)
    .join(' · ')
}

export const HistoryTab = ({
  history,
  ragDocs = [],
  onRefresh,
  refreshing = false,
  pagination,
  onChangePage,
  onChangePageSize
}) => {
  const [query, setQuery] = useState('')
  const [userEmailFilter, setUserEmailFilter] = useState('')
  const [intentFilter, setIntentFilter] = useState('all')
  const [appFilter, setAppFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [selectedChunkKey, setSelectedChunkKey] = useState('')
  const [selectedRuleMeta, setSelectedRuleMeta] = useState(null)

  const totalHistoryCount = Array.isArray(history) ? history.length : 0

  const appOptions = useMemo(() => {
    const values = Array.from(
      new Set((history ?? []).map((item) => String(item?.currentApp ?? '').trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right))

    return ['all', ...values]
  }, [history])

  const actionOptions = useMemo(() => {
    const values = Array.from(
      new Set((history ?? []).map((item) => String(item?.chatAction ?? '').trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right))

    return ['all', ...values]
  }, [history])

  const filteredHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const normalizedUserEmail = userEmailFilter.trim().toLowerCase()

    return (history ?? []).filter((item) => {
      const debugMeta = toDebugMeta(item)
      const loginUser = summarizeLoginUser(debugMeta, item)
      const displayEmail = resolveDisplayEmail(loginUser, item)
      const currentApp = String(item?.currentApp ?? '').trim()
      const chatAction = String(item?.chatAction ?? '').trim()
      const itemIntent = String(debugMeta?.pipelineIntent ?? '')
        .trim()
        .toLowerCase()
      const matchedRule =
        debugMeta?.matchedRule && typeof debugMeta.matchedRule === 'object' ? debugMeta.matchedRule : {}

      if (appFilter !== 'all' && currentApp !== appFilter) return false
      if (actionFilter !== 'all' && chatAction !== actionFilter) return false
      if (intentFilter !== 'all' && itemIntent !== intentFilter) return false
      if (normalizedUserEmail && !displayEmail.toLowerCase().includes(normalizedUserEmail)) return false

      if (!normalizedQuery) return true

      const haystack = [
        item?.userMessage,
        item?.assistantText,
        item?.currentPath,
        item?.currentApp,
        item?.chatAction,
        item?.author,
        displayEmail,
        item?.conversationId,
        debugMeta?.pipelineIntent,
        debugMeta?.pipelineTrace,
        debugMeta?.usedCollection,
        matchedRule?.ruleKey,
        matchedRule?.ruleType,
        matchedRule?.reason,
        ...(Array.isArray(debugMeta?.usedChunks) ? debugMeta.usedChunks : [])
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ')

      return haystack.includes(normalizedQuery)
    })
  }, [history, query, userEmailFilter, intentFilter, appFilter, actionFilter])

  const ragDocByChunkKey = useMemo(() => {
    const map = new Map()
    for (const row of Array.isArray(ragDocs) ? ragDocs : []) {
      const chunkKey = String(row?.chunkKey ?? row?.id ?? '').trim()
      if (!chunkKey || map.has(chunkKey)) continue
      map.set(chunkKey, row)
    }
    return map
  }, [ragDocs])

  const selectedRagDoc = selectedChunkKey ? ragDocByChunkKey.get(selectedChunkKey) : undefined

  return (
    <SettingCard>
      <SectionTitleRow>
        <CardHeader>
          <CardTitle>최근 채팅 내역</CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SmallBadge>
              {filteredHistory.length}/{totalHistoryCount}건
            </SmallBadge>
            <PrimaryButton
              type="button"
              onClick={() => onRefresh?.()}
              disabled={refreshing}
              style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
            >
              {refreshing ? '갱신 중...' : '리스트 갱신'}
            </PrimaryButton>
          </div>
        </CardHeader>
      </SectionTitleRow>

      <PageDescription>AI Assistant 패널에서 주고받은 최근 대화를 확인할 수 있습니다.</PageDescription>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '10px',
          marginTop: '10px',
          marginBottom: '14px'
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="메시지/경로/액션 검색"
          style={{
            height: '40px',
            border: '1px solid #dbe3ef',
            borderRadius: '10px',
            padding: '0 12px',
            fontSize: '13px',
            color: '#334155',
            background: '#fff'
          }}
        />

        <input
          value={userEmailFilter}
          onChange={(e) => setUserEmailFilter(e.target.value)}
          placeholder="사용자 email 필터"
          style={{
            height: '40px',
            border: '1px solid #dbe3ef',
            borderRadius: '10px',
            padding: '0 12px',
            fontSize: '13px',
            color: '#334155',
            background: '#fff'
          }}
        />

        <select
          value={intentFilter}
          onChange={(e) => setIntentFilter(e.target.value)}
          style={{
            height: '40px',
            border: '1px solid #dbe3ef',
            borderRadius: '10px',
            padding: '0 10px',
            fontSize: '13px',
            color: '#334155',
            background: '#fff'
          }}
        >
          <option value="all">인텐트 전체</option>
          <option value="info">info</option>
          <option value="action">action</option>
        </select>

        <select
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          style={{
            height: '40px',
            border: '1px solid #dbe3ef',
            borderRadius: '10px',
            padding: '0 10px',
            fontSize: '13px',
            color: '#334155',
            background: '#fff'
          }}
        >
          {appOptions.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? '앱 전체' : value}
            </option>
          ))}
        </select>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{
            height: '40px',
            border: '1px solid #dbe3ef',
            borderRadius: '10px',
            padding: '0 10px',
            fontSize: '13px',
            color: '#334155',
            background: '#fff'
          }}
        >
          {actionOptions.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? '액션 전체' : value}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          marginBottom: '12px',
          padding: '10px 12px',
          border: '1px solid #dbe3ef',
          borderRadius: '10px',
          background: '#f8fafc'
        }}
      >
        <div style={{ fontSize: '12px', color: '#334155' }}>
          페이지 {Number(pagination?.page ?? 1)} / {Math.max(1, Number(pagination?.totalPages ?? 1))}
          {' · '}
          전체 {Number(pagination?.total ?? filteredHistory.length)}건
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={Number(pagination?.pageSize ?? 20)}
            onChange={(e) => onChangePageSize?.(Number(e.target.value))}
            disabled={refreshing}
            style={{
              height: '30px',
              border: '1px solid #dbe3ef',
              borderRadius: '8px',
              padding: '0 8px',
              fontSize: '12px',
              color: '#334155',
              background: '#fff'
            }}
          >
            <option value={20}>20개</option>
            <option value={50}>50개</option>
            <option value={100}>100개</option>
          </select>

          <PrimaryButton
            type="button"
            onClick={() => onChangePage?.(Math.max(1, Number(pagination?.page ?? 1) - 1))}
            disabled={refreshing || !pagination?.hasPrev}
            style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
          >
            이전
          </PrimaryButton>

          <PrimaryButton
            type="button"
            onClick={() =>
              onChangePage?.(Math.min(Number(pagination?.totalPages ?? 1), Number(pagination?.page ?? 1) + 1))
            }
            disabled={refreshing || !pagination?.hasNext}
            style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
          >
            다음
          </PrimaryButton>
        </div>
      </div>

      <HistoryList>
        {filteredHistory.length > 0 ? (
          filteredHistory.map((item) => {
            const debugMeta = toDebugMeta(item)
            const matchedRule =
              debugMeta?.matchedRule && typeof debugMeta.matchedRule === 'object' ? debugMeta.matchedRule : {}
            const matchedRuleSource = String(matchedRule?.source ?? '').trim()
            const matchedRuleKey = String(matchedRule?.ruleKey ?? '').trim()
            const matchedRuleType = String(matchedRule?.ruleType ?? '').trim()
            const matchedRuleReason = String(matchedRule?.reason ?? '').trim()
            const matchedRuleConfidence = toFiniteNumber(matchedRule?.confidence)
            const intent = String(debugMeta?.pipelineIntent ?? '').trim()
            const trace = String(debugMeta?.pipelineTrace ?? '').trim()
            const confidence = Number(debugMeta?.pipelineConfidence)
            const usedCollection = String(debugMeta?.usedCollection ?? '').trim()
            const primaryChunkKey = String(debugMeta?.primaryChunkKey ?? '').trim()
            const usedChunks = Array.isArray(debugMeta?.usedChunks)
              ? debugMeta.usedChunks.map((value) => String(value ?? '').trim()).filter(Boolean)
              : []
            const effectivePrimaryChunkKey = primaryChunkKey || usedChunks[0] || ''
            const ragScores = Array.isArray(debugMeta?.ragScores) ? debugMeta.ragScores : []
            const ragMatchScore = toFiniteNumber(debugMeta?.ragMatchScore)
            const ragAdjustedScore = toFiniteNumber(debugMeta?.ragAdjustedScore)
            const ragThresholdScore = toFiniteNumber(debugMeta?.ragThresholdScore)
            const ragMinScore = ragThresholdScore ?? toFiniteNumber(debugMeta?.ragMinScore)
            const defaultLlmFallback = Boolean(debugMeta?.defaultLlmFallback)
            const source = String(debugMeta?.source ?? '').trim()
            const isRuleHandled = source === 'rule-first' || source === 'front-rule'
            const sourceLabel =
              source === 'rule-first'
                ? 'Rule First'
                : source === 'front-rule'
                  ? 'Front Rule'
                  : source === 'orchestrator'
                    ? 'Orchestrator'
                    : source === 'guidance'
                      ? 'Guidance'
                      : '-'
            const flowTrace = toFlowTrace(debugMeta)
            const ragRole = resolveRagRole(flowTrace?.decisions, debugMeta)
            const ragStateLabel = isRuleHandled ? '스킵' : defaultLlmFallback ? '폴백' : RAG_ROLE_LABEL[ragRole]
            const finalProcessingLabel = isRuleHandled
              ? 'RAG 스킵 (rule 매칭 처리)'
              : defaultLlmFallback
                ? 'RAG 미채택 -> LLM 폴백'
                : ragRole === 'context'
                  ? 'RAG 문서를 도구 프롬프트 참고로만 사용 (답변 근거 아님)'
                  : ragRole === 'answer'
                    ? 'RAG 채택 (답변 근거)'
                    : 'RAG 미사용'
            const loginUser = summarizeLoginUser(debugMeta, item)
            const displayEmail = resolveDisplayEmail(loginUser, item)
            const ruleDisplayText = matchedRuleKey
              ? `${matchedRuleKey}${matchedRuleType ? ` (${matchedRuleType})` : ''}${matchedRuleSource ? ` [${matchedRuleSource}]` : ''}`
              : '-'
            const flowWithRule = formatFlowSteps({
              trace,
              matchedRuleKey,
              source,
              ruleDisplayText,
              matchedRuleConfidence,
              matchedRuleReason
            })

            return (
              <HistoryCard key={item.id}>
                <HistoryMeta>
                  <span>{formatDateTime(item.createdAt)}</span>
                  <span>ID {Number(item?.id ?? 0) || '-'}</span>
                  <span>{item.currentApp || '-'}</span>
                  <span>{item.currentPath || '-'}</span>
                  <span>{item.chatAction || '-'}</span>
                </HistoryMeta>

                <div
                  style={{
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    alignItems: 'start'
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gap: '10px',
                      border: '1px solid #dbe3ef',
                      borderRadius: '10px',
                      background: '#ffffff',
                      padding: '12px'
                    }}
                  >
                    <div style={{ display: 'grid', gap: '6px' }}>
                      <SmallBadge>대화</SmallBadge>

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div
                          style={{
                            maxWidth: '90%',
                            background: 'linear-gradient(135deg,#CD7B94,#BF2D59,#B91C4C)',
                            color: '#ffffff',
                            borderRadius: '16px 16px 4px 16px',
                            padding: '10px 13px',
                            fontSize: '13px',
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                          }}
                        >
                          <div style={{ fontSize: '11px', opacity: 0.9, marginBottom: '4px' }}>{displayEmail}</div>
                          {item.userMessage || '-'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div
                          style={{
                            maxWidth: '90%',
                            background: '#f4f5f7',
                            color: '#262f44',
                            borderRadius: '16px 16px 16px 4px',
                            padding: '10px 13px',
                            fontSize: '13px',
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                          }}
                        >
                          <div style={{ fontSize: '11px', color: '#adb5bd', marginBottom: '4px' }}>AI Assistant</div>
                          {item.assistantText || '-'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: '8px',
                      border: '1px solid #dbe3ef',
                      borderRadius: '10px',
                      background: '#f8fafc',
                      padding: '10px'
                    }}
                  >
                    <SmallBadge>디버그 정보</SmallBadge>
                    <DebugSummaryBar>
                      <DebugChip $tone="blue">Source: {sourceLabel}</DebugChip>
                      <DebugChip
                        $tone={
                          isRuleHandled || ragRole === 'unused' ? 'slate' : ragRole === 'answer' ? 'green' : 'amber'
                        }
                      >
                        RAG: {ragStateLabel}
                      </DebugChip>
                      <DebugChip $tone={matchedRuleKey ? 'amber' : 'slate'}>
                        Rule: {matchedRuleKey ? '매칭' : '미매칭'}
                      </DebugChip>
                      <DebugChip $tone="slate">매칭 점수: {formatScore(ragMatchScore)}</DebugChip>
                      <DebugChip $tone="slate">채택 기준: {formatScore(ragMinScore)}</DebugChip>
                    </DebugSummaryBar>

                    <DebugGrid>
                      <DebugMetricCard>
                        <DebugMetricLabel>의도 분류</DebugMetricLabel>
                        <DebugMetricValue>{summarizeDebugIntent(intent, confidence)}</DebugMetricValue>
                      </DebugMetricCard>

                      <DebugMetricCard>
                        <DebugMetricLabel>매칭 룰</DebugMetricLabel>
                        <DebugMetricValue>
                          {matchedRuleKey ? (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedRuleMeta({
                                  key: matchedRuleKey,
                                  type: matchedRuleType,
                                  source: matchedRuleSource,
                                  confidence: matchedRuleConfidence,
                                  reason: matchedRuleReason
                                })
                              }
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#1d4ed8',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                padding: 0,
                                fontSize: '12px',
                                fontWeight: 700
                              }}
                            >
                              {ruleDisplayText}
                            </button>
                          ) : (
                            '-'
                          )}
                        </DebugMetricValue>
                      </DebugMetricCard>

                      <DebugMetricCard>
                        <DebugMetricLabel>선택된 RAG</DebugMetricLabel>
                        <DebugMetricValue>
                          {usedCollection || '-'}{' '}
                          {effectivePrimaryChunkKey ? (
                            <button
                              type="button"
                              onClick={() => setSelectedChunkKey(effectivePrimaryChunkKey)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#1d4ed8',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                padding: 0,
                                fontSize: '12px',
                                marginLeft: '4px'
                              }}
                            >
                              {effectivePrimaryChunkKey}
                            </button>
                          ) : null}
                        </DebugMetricValue>
                      </DebugMetricCard>
                    </DebugGrid>

                    <details>
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 800,
                          color: '#1e3a8a',
                          padding: '2px 0'
                        }}
                      >
                        응답 생성 흐름 보기
                      </summary>
                      <div style={{ marginTop: '8px' }}>
                        <DebugDetailPanel>
                          <DebugDetailTitle>응답 생성 흐름</DebugDetailTitle>
                          <DebugMonoBlock>{flowWithRule}</DebugMonoBlock>
                        </DebugDetailPanel>
                      </div>
                    </details>

                    {flowTrace ? (
                      <>
                        <FlowDecisionChips decisions={flowTrace.decisions} />

                        <details>
                          <summary
                            style={{
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: 800,
                              color: '#1e3a8a',
                              padding: '2px 0'
                            }}
                          >
                            처리 단계 전체 보기 ({flowTrace.steps.length}단계
                            {flowTrace.totalMs !== undefined ? ` · ${flowTrace.totalMs}ms` : ''})
                          </summary>
                          <div style={{ marginTop: '8px' }}>
                            <DebugDetailPanel>
                              <DebugDetailTitle>
                                단계별 처리 흐름 {flowTrace.reqId ? `(reqId ${flowTrace.reqId})` : ''}
                              </DebugDetailTitle>
                              <div style={{ display: 'grid', gap: '4px', marginTop: '6px' }}>
                                {flowTrace.steps.map((step, index) => (
                                  <div
                                    key={`flow-step-${item.id}-${index}`}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: '6px',
                                      fontSize: '12px',
                                      color: '#334155'
                                    }}
                                  >
                                    <DebugChip $tone={STEP_TONE[String(step?.status ?? 'ok')] ?? 'slate'}>
                                      {Number(step?.seq ?? index + 1)}. {String(step?.stage ?? '-')}
                                    </DebugChip>
                                    <span style={{ paddingTop: '3px', wordBreak: 'break-word' }}>
                                      {formatStepDetail(step?.detail) || '-'}
                                      {Number.isFinite(Number(step?.elapsedMs))
                                        ? ` (+${Number(step.elapsedMs)}ms)`
                                        : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </DebugDetailPanel>
                          </div>
                        </details>
                      </>
                    ) : null}

                    <details>
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 800,
                          color: '#1e3a8a',
                          padding: '2px 0'
                        }}
                      >
                        RAG 판단/비교 상세 보기
                      </summary>
                      <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
                        <DebugDetailPanel>
                          <DebugDetailTitle>RAG 판단 요약</DebugDetailTitle>
                          <DebugMonoBlock>
                            {`채택된 매칭 점수(topScore): ${formatScore(ragMatchScore)}\n채택된 보정 점수(adjustedScore): ${formatScore(ragAdjustedScore)}\n채택 기준 점수(minScore): ${formatScore(ragMinScore)}\n최종 처리: ${finalProcessingLabel}\n\ntopScore: 검색 매칭 원점수\nadjustedScore: 우선순위 가중치(화면 보너스 등) 반영 점수\nhitCount: 해당 컬렉션에서 매칭된 청크 개수\ntopChunks: 상위 매칭 chunk_key`}
                          </DebugMonoBlock>
                        </DebugDetailPanel>

                        <DebugDetailPanel>
                          <DebugDetailTitle>RAG 점수 상세 ({ragScores.length}개)</DebugDetailTitle>
                          {ragScores.length > 0 ? (
                            <div style={{ display: 'grid', gap: '8px' }}>
                              {ragScores.map((row, index) => {
                                const collection = String(row?.collection ?? '').trim() || '-'
                                const topScoreNum = toFiniteNumber(row?.topScore)
                                const topScore = formatScore(row?.topScore)
                                const adjustedScore = formatScore(row?.adjustedScore)
                                const hitCount = Number.isFinite(Number(row?.hitCount)) ? Number(row?.hitCount) : 0
                                const topChunkIds = normalizeChunkKeys(row?.topChunkIds)
                                const topChunks = Array.isArray(row?.topChunks)
                                  ? row.topChunks
                                      .map((chunkRow) => ({
                                        chunkKey: String(chunkRow?.chunkKey ?? '').trim(),
                                        finalScore: formatScore(chunkRow?.finalScore),
                                        rawScore: formatScore(chunkRow?.rawScore)
                                      }))
                                      .filter((chunkRow) => Boolean(chunkRow.chunkKey))
                                  : []
                                const chunkScoreEntries =
                                  topChunks.length > 0
                                    ? topChunks
                                    : topChunkIds.map((chunkKey) => ({ chunkKey, finalScore: '-', rawScore: '-' }))
                                const passesThreshold =
                                  ragMinScore !== undefined && topScoreNum !== undefined
                                    ? topScoreNum >= ragMinScore
                                    : undefined
                                const isSelected =
                                  Boolean(usedCollection) && collection === usedCollection && usedChunks.length > 0

                                let selectionReason = '판정 정보 없음'
                                if (passesThreshold === false) {
                                  selectionReason = `미채택 (기준 ${ragMinScore?.toFixed(2)} 미만)`
                                } else if (passesThreshold === true && isSelected) {
                                  selectionReason = '채택 (기준 통과 + 최종 선택)'
                                } else if (passesThreshold === true && !isSelected) {
                                  selectionReason = '미채택 (기준 통과, 다른 컬렉션이 최종 선택)'
                                } else if (passesThreshold === undefined && isSelected) {
                                  selectionReason = '채택 (최종 선택)'
                                }

                                return (
                                  <div
                                    key={`rag-score-${item.id}-${index}`}
                                    style={{
                                      border: '1px solid #dbe3ef',
                                      borderRadius: '12px',
                                      padding: '10px 12px',
                                      fontSize: '12px',
                                      color: '#334155',
                                      background: isSelected ? '#f8fbff' : '#ffffff',
                                      boxShadow: isSelected ? '0 10px 24px rgba(29, 78, 216, 0.08)' : 'none',
                                      minWidth: '260px'
                                    }}
                                  >
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                                      <DebugChip $tone="blue">collection: {collection}</DebugChip>
                                      <DebugChip $tone="slate">topScore: {topScore}</DebugChip>
                                      <DebugChip $tone="slate">adjustedScore: {adjustedScore}</DebugChip>
                                      <DebugChip $tone="slate">hitCount: {hitCount}</DebugChip>
                                    </div>

                                    <DebugDetailPanel style={{ padding: '8px 10px' }}>
                                      <DebugDetailTitle>채택 판정</DebugDetailTitle>
                                      <DebugMonoBlock style={{ padding: 0, border: 'none', background: 'transparent' }}>
                                        {selectionReason}
                                      </DebugMonoBlock>
                                    </DebugDetailPanel>

                                    <div style={{ marginTop: '8px' }}>
                                      <DebugDetailTitle>chunk 최종 스코어</DebugDetailTitle>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                        {chunkScoreEntries.length > 0 ? (
                                          chunkScoreEntries.map(({ chunkKey, finalScore, rawScore }, chunkIndex) => (
                                            <button
                                              key={`score-chunk-${item.id}-${index}-${chunkKey}-${chunkIndex}`}
                                              type="button"
                                              onClick={() => setSelectedChunkKey(chunkKey)}
                                              style={{
                                                border: '1px solid #bfdbfe',
                                                background: '#eff6ff',
                                                color: '#1d4ed8',
                                                cursor: 'pointer',
                                                borderRadius: '999px',
                                                padding: '4px 10px',
                                                fontSize: '12px'
                                              }}
                                            >
                                              {chunkKey} (final {finalScore} / raw {rawScore})
                                            </button>
                                          ))
                                        ) : (
                                          <span style={{ color: '#94a3b8' }}>-</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <PageDescription style={{ marginTop: '0' }}>
                              {isRuleHandled
                                ? 'rule 매칭 처리로 RAG를 스킵하여 점수 정보가 없습니다.'
                                : '저장된 RAG 점수 정보가 없습니다.'}
                            </PageDescription>
                          )}
                        </DebugDetailPanel>
                      </div>
                    </details>
                  </div>
                </div>
              </HistoryCard>
            )
          })
        ) : (
          <PageDescription>검색/필터 조건에 맞는 채팅 내역이 없습니다.</PageDescription>
        )}
      </HistoryList>

      {selectedChunkKey ? (
        <ModalBackdrop onClick={() => setSelectedChunkKey('')}>
          <ModalCard
            style={{ width: 'min(760px, 100%)', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <ModalTitle>RAG 상세: {selectedChunkKey}</ModalTitle>
            <ModalDescription>선택한 chunk_key의 실제 문서 내용을 확인할 수 있습니다.</ModalDescription>

            <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>컬렉션(key):</strong> {String(selectedRagDoc?.key ?? '-').trim() || '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>제목(title):</strong> {String(selectedRagDoc?.title ?? '-').trim() || '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>키워드(keywords):</strong>{' '}
                {Array.isArray(selectedRagDoc?.keywords) ? selectedRagDoc.keywords.join(', ') : '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>본문(body):</strong>
              </div>
              <HistoryMessage>
                {String(selectedRagDoc?.body ?? '').trim() || '해당 chunk_key에 매칭되는 RAG 문서를 찾지 못했습니다.'}
              </HistoryMessage>
            </div>

            <ModalActions>
              <PrimaryButton type="button" onClick={() => setSelectedChunkKey('')}>
                닫기
              </PrimaryButton>
            </ModalActions>
          </ModalCard>
        </ModalBackdrop>
      ) : null}

      {selectedRuleMeta ? (
        <ModalBackdrop onClick={() => setSelectedRuleMeta(null)}>
          <ModalCard
            style={{ width: 'min(640px, 100%)', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <ModalTitle>Rule 매칭 상세</ModalTitle>
            <ModalDescription>해당 응답이 어떤 룰에 의해 매칭되었는지 확인할 수 있습니다.</ModalDescription>

            <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>ruleKey:</strong> {String(selectedRuleMeta?.key ?? '-').trim() || '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>ruleType:</strong> {String(selectedRuleMeta?.type ?? '-').trim() || '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>source:</strong> {String(selectedRuleMeta?.source ?? '-').trim() || '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>confidence:</strong>{' '}
                {selectedRuleMeta?.confidence !== undefined ? Number(selectedRuleMeta.confidence).toFixed(2) : '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                <strong>reason:</strong> {String(selectedRuleMeta?.reason ?? '-').trim() || '-'}
              </div>
            </div>

            <ModalActions>
              <PrimaryButton type="button" onClick={() => setSelectedRuleMeta(null)}>
                닫기
              </PrimaryButton>
            </ModalActions>
          </ModalCard>
        </ModalBackdrop>
      ) : null}
    </SettingCard>
  )
}
