import { findClosestContent, nameDistance } from './taskflow-palette'
import type { TaskContentRef } from './taskflow-palette'

const content = (taskName: string, contentName: string, contentId: number): TaskContentRef => ({
  taskId: 1,
  taskName,
  contentName,
  contentId,
})

describe('오타 허용 매칭', () => {
  it('자리 바뀜은 한 번의 실수로 센다', () => {
    expect(nameDistance('puase', 'Pause')).toBe(1)
    expect(nameDistance('pause', 'Pause')).toBe(0)
    expect(nameDistance('Parallel', 'Pause')).toBeGreaterThan(2)
  })

  it('가장 가까운 콘텐츠를 고른다', () => {
    const contents = [content('PlayFace', 'Love', 41), content('PlayFace', 'Idle', 42)]

    expect(findClosestContent('Lvoe', 'PlayFace', contents)?.contentName).toBe('Love')
    expect(findClosestContent('bouquet', 'PlayFace', contents)).toBeUndefined()
  })

  it('짧은 이름은 오타를 허용하지 않는다(엉뚱한 노드가 잡힌다)', () => {
    const contents = [content('PlayFace', 'Joy', 43), content('PlayFace', 'Job', 44)]

    expect(findClosestContent('Jay', 'PlayFace', contents)).toBeUndefined()
  })

  it('같은 거리의 후보가 둘이면 매칭하지 않는다', () => {
    const contents = [content('PlayFace', 'Love', 41), content('PlayFace', 'Love2', 45)]

    expect(findClosestContent('Lovee', 'PlayFace', contents)).toBeUndefined()
  })
})
