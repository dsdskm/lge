/*
 * SPDX-FileCopyrightText: Copyright 2026 LG Electronics Inc.
 * SPDX-License-Identifier: LicenseRef-LGE-Proprietary
 */

export const actionNodeType = 'action' as const
export const actionNodeName = 'action' as const

// 분기를 계속 RUNNING 으로 유지시키는 로봇 측 액션(캔버스에는 없고 BT 생성 시에만 추가된다).
export const alwaysRunningActionTag = 'AlwaysRunning' as const
export const alwaysRunningActionName = 'always_running' as const

export type BtActionNode = {
  kind: typeof actionNodeType
  tag: string
  name: string
  attrs: Record<string, string>
}
