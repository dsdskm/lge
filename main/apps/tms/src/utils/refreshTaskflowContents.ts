/*
 * SPDX-FileCopyrightText: Copyright 2026 LG Electronics Inc.
 * SPDX-License-Identifier: LicenseRef-LGE-Proprietary
 */

import { ContentVersionInfo } from './fetchAvailableContents'

// 저장된 taskflow(flowDefinition)의 contents 를 최신 콘텐츠 목록으로 갱신한다.
//
// - flowDefinition.contents[] : taskflow 가 사용하는 콘텐츠 스냅샷(저장 시점). 항목 키: id, name,
//   contentTypeId, contentTypeName, contentValue, version ...
// - flowDefinition.nodes[].data : 콘텐츠 노드는 content* 필드(contentId, contentName, contentTypeId,
//   contentTypeName, contentValue, contentVersion)를 갖는다.
// - 최신 목록(availableContents, api/v1/web/contents 응답)과 id 로 매칭하고, version 이 다르면 갱신 대상.
//   (contentId 는 매칭 키라 유지, 나머지 값만 교체)
//
// 이 모듈은 순수 함수다(원본 flowDefinition 은 변경하지 않고 복제본을 반환). fetch 는 별도 모듈 참고.

// 최신 콘텐츠 항목(GET api/v1/web/contents 응답의 content[] 항목). taskflow.contents[] 항목과 동형.
export type AvailableContent = {
  id: number
  version?: string | number | null
  name?: string
  contentTypeId?: number
  contentTypeName?: string
  contentValue?: string
  rawDataId?: string | null
  groupId?: string | null
  siteId?: string | null
  status?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

// 버전이 바뀌어 갱신된 콘텐츠 요약(로깅/후속 UX 용).
export type ContentChange = {
  id: number
  name?: string
  fromVersion: string | null
  toVersion: string | null
}

// taskflow 엔 있으나 최신 목록에 없어서 갱신하지 못한 콘텐츠.
export type MissingContent = {
  id: number
  name?: string
  version: string | null
}

export type RefreshTaskflowContentsResult<T = Record<string, any>> = {
  flowDefinition: T // 갱신된 복제본(원본 불변)
  changed: ContentChange[]
  missing: MissingContent[]
}

function normalizeVersion(value: unknown): string | null {
  return value == null ? null : String(value)
}

// contents[] 항목의 값을 최신 콘텐츠로 교체(id 는 유지).
function applyToContentsItem(item: Record<string, any>, fresh: AvailableContent): void {
  if (fresh.version !== undefined) item.version = fresh.version
  if (fresh.name !== undefined) item.name = fresh.name
  if (fresh.contentTypeId !== undefined) item.contentTypeId = fresh.contentTypeId
  if (fresh.contentTypeName !== undefined) item.contentTypeName = fresh.contentTypeName
  if (fresh.contentValue !== undefined) item.contentValue = fresh.contentValue
}

// 노드 data 의 content* 필드를 최신 콘텐츠로 교체(contentId 는 매칭 키라 유지).
function applyToNodeData(data: Record<string, any>, fresh: AvailableContent): void {
  if (fresh.name !== undefined) data.contentName = fresh.name
  if (fresh.contentTypeId !== undefined) data.contentTypeId = fresh.contentTypeId
  if (fresh.contentTypeName !== undefined) data.contentTypeName = fresh.contentTypeName
  if (fresh.contentValue !== undefined) data.contentValue = fresh.contentValue
  if (fresh.version !== undefined) data.contentVersion = fresh.version
}

export function getContentIdsInNodes<N extends { data?: any }>(nodes: N[]) {
  const contentsIds = new Map<number, string>()

  for (const node of nodes) {
    const data = node?.data
    const contentId = Number(data?.contentId)
    if (!data || !Number.isFinite(contentId)) {
      continue
    }
    const currentVersion = normalizeVersion(data.contentVersion)
    contentsIds.set(contentId, currentVersion!)
  }

  return contentsIds
}

export function getContentIdsInTaskflow<T extends Record<string, any>>(flowDefinition: T) {
  const contentsIds = new Map<number, string>()

  // 1) contents[] 갱신 (version 이 다른 것만). 최신 목록에 없으면 missing.
  const contents: any[] = Array.isArray(flowDefinition.contents) ? flowDefinition.contents : []
  for (const item of contents) {
    const id = Number(item?.id)
    if (!Number.isFinite(id)) continue
    contentsIds.set(id, item.version)
  }

  return contentsIds
}

export function refreshTaskflowContents<T extends Record<string, any>>(
  flowDefinition: T,
  availableContents: AvailableContent[]
): RefreshTaskflowContentsResult<T> {
  // id → 최신 콘텐츠
  const availableById = new Map<number, AvailableContent>()
  for (const c of availableContents ?? []) {
    if (c && c.id != null) availableById.set(Number(c.id), c)
  }

  // 원본 불변: 깊은 복제 후 수정
  const next = JSON.parse(JSON.stringify(flowDefinition)) as T
  const changed: ContentChange[] = []
  const missing: MissingContent[] = []
  const changedIds = new Set<number>()

  // 1) contents[] 갱신 (version 이 다른 것만). 최신 목록에 없으면 missing.
  const contents: any[] = Array.isArray((next as any).contents) ? (next as any).contents : []
  for (const item of contents) {
    const id = Number(item?.id)
    if (!Number.isFinite(id)) continue
    const fresh = availableById.get(id)
    if (!fresh) {
      missing.push({ id, name: item.name as string, version: normalizeVersion(item.version) })
      continue
    }

    const fromVersion = normalizeVersion(item.version)
    const toVersion = normalizeVersion(fresh.version)
    if (fromVersion === toVersion) continue // 버전 동일 → 변경 없음

    changed.push({ id, name: (item.name as string) ?? fresh.name, fromVersion, toVersion })
    changedIds.add(id)
    applyToContentsItem(item, fresh)
  }

  // 2) 갱신된 콘텐츠를 참조하는 노드의 content* 필드 갱신
  const nodes: any[] = Array.isArray((next as any).nodes) ? (next as any).nodes : []
  for (const node of nodes) {
    const data = node?.data
    if (!data) continue
    const contentId = Number(data.contentId)
    if (!Number.isFinite(contentId) || !changedIds.has(contentId)) continue
    const fresh = availableById.get(contentId)
    if (fresh) applyToNodeData(data, fresh)
  }

  return { flowDefinition: next, changed, missing }
}

export type RefreshContentNodesResult<N = any> = {
  nodes: N[]
  changed: ContentChange[]
  missing: MissingContent[]
}

// 라이브 편집용: 노드의 content* 필드를 최신 콘텐츠로 갱신한다.
// (저장 시 contents 는 노드에서 파생되므로 노드만 갱신하면 contents 도 반영됨)
//  - id(contentId) 로 매칭. 버전이 다르면 갱신(changed), 최신 목록에 없으면 missing, 같으면 스킵.
//  - 원본 노드 배열/객체는 변경하지 않고 새 배열을 반환한다(변경된 노드만 새 객체).
export function refreshContentNodes<N extends { data?: any }>(
  nodes: N[],
  updatedContents: AvailableContent[],
  missingContents: ContentVersionInfo[]
): RefreshContentNodesResult<N> {
  const updatedContentsById = new Map<number, AvailableContent>()
  for (const c of updatedContents ?? []) {
    if (c && c.id != null) updatedContentsById.set(Number(c.id), c)
  }
  const missingIdsSet = new Set(missingContents.map((contentInfo) => contentInfo.id))

  const changed: ContentChange[] = []
  const missing: MissingContent[] = []

  const nextNodes = (nodes ?? []).map((node) => {
    const data = node?.data
    const contentId = Number(data?.contentId)
    if (!data || !Number.isFinite(contentId)) return node // 콘텐츠 노드가 아님

    const currentVersion = normalizeVersion(data.contentVersion)

    if (missingIdsSet.has(contentId)) {
      missing.push({ id: contentId, name: data.contentName, version: currentVersion })
    }
    const fresh = updatedContentsById.get(contentId)

    if (!fresh) {
      return node
    }

    const newVersion = normalizeVersion(fresh.version)

    changed.push({
      id: contentId,
      name: data.contentName ?? fresh.name,
      fromVersion: currentVersion,
      toVersion: newVersion
    })
    const nextData = { ...data }
    applyToNodeData(nextData, fresh)
    return { ...node, data: nextData }
  })

  return { nodes: nextNodes, changed, missing }
}
