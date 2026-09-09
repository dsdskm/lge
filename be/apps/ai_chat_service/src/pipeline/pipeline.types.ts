/**
 * 챗봇 파이프라인 공용 타입.
 *
 * 요청 처리 흐름:
 *   화면 라우팅(currentApp+currentPath) → 인텐트 분류 → 인텐트별 핸들러
 *     - info   : RAG 문서 조회 후 근거 기반 답변
 *     - action : 액션 실행 / 데이터 조회 / 필터 적용 후 응답 생성
 *
 *  NOTE:
 *  - 기존 data 분류는 action으로 통합 처리한다.
 */

import type { ChatFlowTrace } from './flow-trace'

export type { ChatFlowTrace }

/** 채팅 메시지 인텐트. */
export type ChatIntent = 'info' | 'action'

/** 멀티턴 대화 히스토리 1턴. 프론트가 최근 N턴을 전달한다. */
export type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
}

/** 프론트로 반환하는 최종 응답. getMockReply 가 기대하던 포맷과 동일. */
export type ChatReplyImage = {
  id: string
  src: string
  alt: string
  title?: string
  caption?: string
}

export type RagScoreEntry = {
  collection: string
  topScore: number
  adjustedScore: number
  hitCount: number
  topChunks: Array<{
    chunkKey: string
    title?: string
    finalScore: number
    rawScore: number
  }>
  topChunkIds: string[]
  relaxed: boolean
}

export type MatchedRuleInfo = {
  source: 'front-rule' | 'orchestrator' | 'guidance'
  ruleKey?: string
  ruleType?: string
  reason?: string
  confidence?: number
}

export type ChatReply = {
  chat_action: string
  chat_action_param?: Record<string, unknown>
  text: string
  pipelineTrace?: string
  pipelineConfidence?: number
  usedCollection?: string
  primaryChunkKey?: string
  usedChunks?: string[]
  ragScores?: RagScoreEntry[]
  matchedRule?: MatchedRuleInfo
  images?: ChatReplyImage[]
}

export type SuggestedAction = {
  id: string
  type: 'navigation' | 'prompt'
  label: string
  keyword: string
  chat_action: string
  chat_action_param?: Record<string, unknown>
}

/** 인텐트 분류 결과. */
export type IntentResult = {
  intent: ChatIntent
  confidence: number
  reason: string
}
