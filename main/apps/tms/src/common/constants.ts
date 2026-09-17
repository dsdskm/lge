// DnD
export const DND_MIME = 'application/x-taskflow-palette' as const
export const DND_FALLBACK_TEXT = 'text/plain' as const

// UI texts
export const TASK_PANEL = {
  SUBTITLE: 'TASK FLOW EDITOR',
  TITLE: '노드',
  SECTION_CONTROL: 'CONTROL',
  SECTION_ACTION: 'ACTION',
  LOADING: '로딩중…'
} as const

// Task types
export const TASK_TYPE_CONTROL = 'CONTROL' as const // 이미 있으면 유지
export const TASK_TYPE_ROOT = 'ROOT' as const

// execution_condition: 메뉴(Boot/Manual) 중 선택, 기본 Boot
export const EXECUTION_CONDITION_KEY = 'execution_condition' as const
export const EXECUTION_CONDITION_OPTIONS = ['Boot', 'Manual'] as const
export const EXECUTION_CONDITION_DEFAULT = 'Boot' as const

// GROUP과 SITE의 '전체'에 해당하는 ID
export const TOTAL_GROUP_ID = 'all'
export const TOTAL_SITE_ID = 'all'

export const SEP = '\u00B7'
