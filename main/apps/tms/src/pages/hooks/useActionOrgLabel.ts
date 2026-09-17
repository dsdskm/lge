import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useOrganizationStore } from '@repo/stores'
import { TOTAL_GROUP_ID } from '@/common/constants'

/**
 * Task(Action)의 생성 위치를 사람이 읽는 문구로 만든다.
 *
 *  - 그룹·사이트가 모두 공용  → "전체 공용"
 *  - 그룹만 지정             → "{그룹} 공용"
 *  - 둘 다 지정              → "{그룹} / {사이트}"
 *
 * 서버는 공용을 응답에서 null, 요청에서 'all' 로 표현하므로 둘 다 공용으로 본다.
 * 이름은 organizationStore 의 allOrgs(code → displayName)에서 찾고, 없으면 id 를 그대로 쓴다.
 */
export function useActionOrgLabel() {
  const { allOrgs } = useOrganizationStore()
  const { t } = useTranslation('tms')

  return useCallback(
    (groupId?: string | null, siteId?: string | null): string => {
      const isShared = (value?: string | null) => !value || value === TOTAL_GROUP_ID
      const displayNameOf = (code: string) =>
        allOrgs.find((org: any) => String(org.code) === String(code))?.displayName ?? code

      if (isShared(groupId)) return t('action.locationShared')
      if (isShared(siteId)) return t('action.locationGroupShared', { group: displayNameOf(groupId!) })
      return `${displayNameOf(groupId!)} / ${displayNameOf(siteId!)}`
    },
    [allOrgs, t]
  )
}
