/*
 * SPDX-FileCopyrightText: Copyright 2026 LG Electronics Inc.
 * SPDX-License-Identifier: LicenseRef-LGE-Proprietary
 */

// taskflow 에서 사용 가능한 최신 콘텐츠 목록을 조회하고, 그걸로 flowDefinition 을 갱신하는 래퍼.
// (순수 갱신 로직은 refreshTaskflowContents 참고)

import { client } from '@repo/apis'
import { ENDPOINTS, GETSIZE } from '@/api/apiConstants'
import { type AvailableContent } from './refreshTaskflowContents'

const axiosClient = client(import.meta.env.VITE_API_BASE_URL)

// GET api/v1/web/contents 응답(페이지 형태).
export type ContentsListResponse = {
  content: AvailableContent[]
  page: number | null
  size: number | null
  totalElements: number | null
  totalPages: number | null
  hasNext: boolean | null
  hasPrev: boolean | null
  nextCursor: string | null
}

export class ContentVersionInfo {
  id!: number
  version!: string
}

export class UpdatedResponseDto {
  updatedContents!: AvailableContent[]

  missingContents!: ContentVersionInfo[]
}

// api/v1/web/contents?groupId=&siteId=&size=100 → 사용 가능한 콘텐츠 목록.
export async function fetchAvailableContents(
  groupId: string | null,
  siteId: string | null,
  size: string | number = GETSIZE
): Promise<AvailableContent[]> {
  const searchParams = new URLSearchParams()
  if (groupId) searchParams.set('groupId', String(groupId))
  if (siteId) searchParams.set('siteId', String(siteId))
  searchParams.set('size', String(size))

  const url = `${ENDPOINTS.TMS.CONTENTS}?${searchParams.toString()}`
  const res = (await axiosClient.get(url)) as ContentsListResponse | AvailableContent[]

  // 페이지 응답(content) 또는 배열 응답 모두 대응
  if (Array.isArray(res)) return res
  return Array.isArray(res?.content) ? res.content : []
}

export async function fetchUpdatedContents(
  groupId: string | null,
  siteId: string | null,
  contentInfos: Map<number, string>,
  size: string = GETSIZE
): Promise<UpdatedResponseDto> {
  const contentVersionInfos = Array.from(contentInfos, ([id, version]) => ({ id, version }))

  const url = `${ENDPOINTS.TMS.CONTENTS_CHECKUPDATED}`
  const res = (await axiosClient.post(url, {
    contentVersionInfos,
    groupId,
    siteId
  })) as UpdatedResponseDto

  return res
}
