import type { ReactNode } from 'react'

/** standalone 프로파일용 레이아웃. GNB·Footer·AI 패널 없이 본문만 그린다. */
const StandaloneLayout = ({ children }: { children: ReactNode }) => (
  <div style={{ height: '100vh', overflow: 'auto', margin: '10px' }}>{children}</div>
)

export default StandaloneLayout
