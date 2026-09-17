import { useOrganizationStore } from '@repo/stores'
import { useEffect, useState, type ReactNode } from 'react'

export function DeviceOrgBootstrap({ children }: { children: ReactNode }) {
  // 로봇 자기 정보
  const setSelectedOrgs = useOrganizationStore((s) => s.setSelectedOrgs)
  const setAllOrgs = useOrganizationStore((s) => s.setAllOrgs)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const groupId = 'device' //data?.provision?.groupId
    const siteId = 'device' //data?.provision?.siteId
    if (!groupId || !siteId) return

    setSelectedOrgs([groupId, siteId])
    setAllOrgs([{ groupId, siteId }])
    setReady(true)
  }, [])

  if (!ready) return <div>loading</div>
  return children
}
