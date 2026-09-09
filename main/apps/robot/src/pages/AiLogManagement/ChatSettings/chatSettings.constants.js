export const EMPTY_MANAGEMENT = {
    screens: [],
    prompts: [],
    guidance: [],
    ragDocs: [],
    rules: [],
    actionTools: [],
    history: [],
}

export const APP_TAB = {
    COMMON: 'common',
    SCREEN: 'screen',
    GUIDANCE: 'guidance',
    PROMPT: 'prompt',
    RAG: 'rag',
    RULE: 'rule',
    ACTION_TOOL: 'actionTool',
    HISTORY: 'history',
}

export const APP_TABS = [
    {
        key: APP_TAB.COMMON,
        label: '공통',
    },
    {
        key: APP_TAB.SCREEN,
        label: '화면 설정',
    },
    {
        key: APP_TAB.GUIDANCE,
        label: '가이드/힌트 설정',
    },
    {
        key: APP_TAB.PROMPT,
        label: '프롬프트 설정',
    },
    {
        key: APP_TAB.RAG,
        label: 'RAG 설정',
    },
    {
        key: APP_TAB.RULE,
        label: 'Rule 설정',
    },
    {
        key: APP_TAB.ACTION_TOOL,
        label: 'Action Tool 설정',
    },
    {
        key: APP_TAB.HISTORY,
        label: '채팅 내역',
    },
]

export const ROBOT_ROUTE = {
    DASHBOARD: 'robot/dashboard',
    MANAGEMENT: 'robot/management',
    AILOG: 'robot/ailog',
    AILOG_EVENT: 'robot/ailog/event',
    AILOG_STATS: 'robot/ailog/stats',
    AILOG_FUNC: 'robot/ailog/func',
    AILOG_ACTION: 'robot/ailog/action',
    AILOG_PROMPT: 'robot/ailog/prompt',
    AILOG_ASSIGNEES: 'robot/ailog/assignees',
    AILOG_REPORT: 'robot/ailog/report',
    GROUPS: 'robot/groups',
    USERS: 'robot/users',
}

export const APP_ROUTE_TREE = {
    [APP_TAB.ROBOT]: [
        {
            key: ROBOT_ROUTE.DASHBOARD,
            label: 'Dashboard',
        },
        {
            key: ROBOT_ROUTE.MANAGEMENT,
            label: 'Management',
        },
        {
            key: ROBOT_ROUTE.AILOG,
            label: 'AI Log',
            children: [
                {
                    key: ROBOT_ROUTE.AILOG_EVENT,
                    label: 'Event',
                },
                {
                    key: ROBOT_ROUTE.AILOG_STATS,
                    label: 'Stats',
                },
                {
                    key: ROBOT_ROUTE.AILOG_FUNC,
                    label: 'Func',
                },
                {
                    key: ROBOT_ROUTE.AILOG_ACTION,
                    label: 'Action',
                },
                {
                    key: ROBOT_ROUTE.AILOG_PROMPT,
                    label: 'Prompt',
                },
                {
                    key: ROBOT_ROUTE.AILOG_ASSIGNEES,
                    label: 'Assignees',
                },
                {
                    key: ROBOT_ROUTE.AILOG_REPORT,
                    label: 'Report',
                },
            ],
        },
        {
            key: ROBOT_ROUTE.GROUPS,
            label: 'Groups',
        },
        {
            key: ROBOT_ROUTE.USERS,
            label: 'Users',
        },
    ],

    [APP_TAB.OTA]: [],
    [APP_TAB.CMS]: [],
    [APP_TAB.TMS]: [],
}