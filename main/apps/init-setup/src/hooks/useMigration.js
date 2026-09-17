import { useCallback, useEffect, useState } from 'react'
import { getMigration } from '@/apis/migrationApis'

/**
 * 단독 설치 → 관제 연동 전환 상태.
 *
 * App 이 메뉴 노출에 쓰고(전환 항목 표시 · 전환 중에는 초기 설정 그룹을 유지) 전환 화면이 목록에
 * 쓴다. 앱 진입 시 한 번만 조회하도록 useRobotSetupStatus 와 같은 모듈 레벨 Promise 캐시를 둔다 —
 * 전환 화면은 작업을 한 뒤 refresh() 로 다시 읽는다.
 *
 * 조회 실패는 '전환할 것 없음' 으로 본다 — 이 상태는 메뉴를 하나 더 보여줄지 결정하는 값이라
 * 실패했을 때 없는 쪽이 안전하다(전환 화면 자체는 URL 로 들어갈 수 있다).
 */
const EMPTY = { available: false, active: false, canFinish: false, localSiteId: null, cloudSite: null, maps: [] }

let migrationPromise = null

export const fetchMigration = () => {
  if (!migrationPromise) {
    migrationPromise = getMigration()
      .then((res) => ({ ...EMPTY, ...(res ?? {}) }))
      .catch((error) => {
        console.warn('Failed to load migration status:', error.message)
        return EMPTY
      })
  }
  return migrationPromise
}

export const resetMigrationCache = () => {
  migrationPromise = null
}

/** @returns {{ loading: boolean, refresh: Function } & typeof EMPTY} */
const useMigration = () => {
  const [state, setState] = useState({ loading: true, ...EMPTY })

  const read = useCallback(async () => {
    const data = await fetchMigration()
    setState({ loading: false, ...data })
    return data
  }, [])

  const refresh = useCallback(async () => {
    resetMigrationCache()
    return read()
  }, [read])

  useEffect(() => {
    let alive = true
    fetchMigration().then((data) => {
      if (alive) setState({ loading: false, ...data })
    })
    return () => {
      alive = false
    }
  }, [])

  return { ...state, refresh }
}

export default useMigration
