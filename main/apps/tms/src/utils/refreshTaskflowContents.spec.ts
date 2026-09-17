/*
 * SPDX-FileCopyrightText: Copyright 2026 LG Electronics Inc.
 * SPDX-License-Identifier: LicenseRef-LGE-Proprietary
 */

import { getContentIdsInTaskflow, refreshTaskflowContents, type AvailableContent } from './refreshTaskflowContents'
import oldTaskflow from '@/bt/__fixtures__/old-contents-taskflow.json'

// 갱신 대상으로 삼을 콘텐츠(MOTION). 이 콘텐츠의 version/value 를 서버에서 바꾼 상황을 시뮬레이션한다.
const CHANGED_CONTENT_ID = 6010
const NEW_VERSION = '2026-08-10T00:00:00.000Z'
const NEW_VALUE =
  '{"id":"6_624_null_null","fileContents":[{"id":999,"fileName":"cloid_thumb_up_v2.robot.yaml","fileType":"MOTION","fileSize":80000,"fileStatus":"STATUS_UPLOAD_DONE"}],"textContents":[]}'
const NEW_NAME = 'thumb_up_v2'

// 원본 contents 를 기반으로 "최신 서버 콘텐츠 목록"을 만든다: 6010 만 version/value/name 변경, 나머지는 동일.
function buildAvailableContents(): AvailableContent[] {
  const list: AvailableContent[] = (oldTaskflow.contents as any[]).map((c) => ({ ...c }))
  const target = list.find((c) => c.id === CHANGED_CONTENT_ID)
  if (!target) throw new Error('fixture 에 대상 콘텐츠가 없습니다')
  target.version = NEW_VERSION
  target.contentValue = NEW_VALUE
  target.name = NEW_NAME
  return list
}

const findContent = (flow: any, id: number) => (flow.contents as any[]).find((c) => c.id === id)
const findNodeByContentId = (flow: any, id: number) => (flow.nodes as any[]).find((n) => n?.data?.contentId === id)

describe('getContentIdsInTaskflow', () => {
  it('taskflow에 있는 컨텐츠 id/version map을 제공한다', () => {
    const result = getContentIdsInTaskflow(oldTaskflow as any)
    const arrayResult = Array.from(result, ([id, value]) => ({ id, version: value }))

    expect(arrayResult.length).toBe(4)
    expect(arrayResult[3]).toEqual({
      id: 17,
      version: '01KVYD70TXN8YQXTHHJ2ZY4TV1'
    })
  })
})

describe('refreshTaskflowContents', () => {
  it('버전이 바뀐 콘텐츠만 changed 로 보고한다', () => {
    const { changed } = refreshTaskflowContents(oldTaskflow as any, buildAvailableContents())

    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({
      id: CHANGED_CONTENT_ID,
      fromVersion: '2026-07-31T04:50:50.239Z',
      toVersion: NEW_VERSION
    })
  })

  it('contents[] 항목의 값(version/contentValue/name)을 최신으로 갱신한다', () => {
    const { flowDefinition } = refreshTaskflowContents(oldTaskflow as any, buildAvailableContents())

    const updated = findContent(flowDefinition, CHANGED_CONTENT_ID)
    expect(updated.version).toBe(NEW_VERSION)
    expect(updated.contentValue).toBe(NEW_VALUE)
    expect(updated.name).toBe(NEW_NAME)
    expect(updated.id).toBe(CHANGED_CONTENT_ID) // id(매칭 키)는 유지
  })

  it('해당 콘텐츠를 참조하는 노드의 content* 필드를 갱신한다(contentId 는 유지)', () => {
    const { flowDefinition } = refreshTaskflowContents(oldTaskflow as any, buildAvailableContents())

    const node = findNodeByContentId(flowDefinition, CHANGED_CONTENT_ID)
    expect(node).toBeDefined()
    expect(node.data.contentId).toBe(CHANGED_CONTENT_ID)
    expect(node.data.contentVersion).toBe(NEW_VERSION)
    expect(node.data.contentValue).toBe(NEW_VALUE)
    expect(node.data.contentName).toBe(NEW_NAME)
  })

  it('버전이 같은 콘텐츠와 그 노드는 그대로 둔다', () => {
    const UNCHANGED_ID = 5974 // FACE:VIDEO, version 동일
    const before = findContent(oldTaskflow, UNCHANGED_ID)
    const beforeVersion = before.version
    const beforeValue = before.contentValue

    const { flowDefinition, changed } = refreshTaskflowContents(oldTaskflow as any, buildAvailableContents())

    expect(changed.some((c) => c.id === UNCHANGED_ID)).toBe(false)
    const after = findContent(flowDefinition, UNCHANGED_ID)
    expect(after.version).toBe(beforeVersion)
    expect(after.contentValue).toBe(beforeValue)
  })

  it('원본 flowDefinition 을 변경하지 않는다(복제본 반환)', () => {
    const originalVersion = findContent(oldTaskflow, CHANGED_CONTENT_ID).version

    refreshTaskflowContents(oldTaskflow as any, buildAvailableContents())

    expect(findContent(oldTaskflow, CHANGED_CONTENT_ID).version).toBe(originalVersion)
  })

  it('최신 목록에 없는 콘텐츠는 건드리지 않는다', () => {
    // 최신 목록을 비워도 오류 없이 원본 값 유지
    const { flowDefinition, changed } = refreshTaskflowContents(oldTaskflow as any, [])
    expect(changed).toHaveLength(0)
    expect(findContent(flowDefinition, CHANGED_CONTENT_ID).version).toBe('2026-07-31T04:50:50.239Z')
  })
})
