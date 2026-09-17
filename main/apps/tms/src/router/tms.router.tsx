import type { ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AiAssistantPanel, MainLayout } from '@repo/ui'
import RouteSync from './tms.routeSync'
import { isDeviceProfile } from '@/common/profile'
import StandaloneLayout from '../adapters/components/standalone'

type RouteItem = {
  name?: string
  path?: string
  element?: ReactNode
  depth?: RouteItem[]
  [key: string]: any
}

interface RouterProps {
  allRoutes: RouteItem[]
  appPrefix: string
  processedAppRoutes: RouteItem[]
  headerRoutes: { name?: string; path?: string }[]
  appT: any
}

const Router = ({ allRoutes, appPrefix, processedAppRoutes, headerRoutes, appT }: RouterProps) => {
  const FULLSCREEN_PATHS = new Set<string>(['/tms/taskflows/:taskFlowId/canvas'])

  const safeAllRoutes = Array.isArray(allRoutes)
    ? allRoutes.filter((item): item is RouteItem => Boolean(item && typeof item === 'object' && item.path))
    : []

  return (
    <>
      <RouteSync appRoutes={processedAppRoutes} />

      <Routes>
        {safeAllRoutes.map((item) => {
          const isFullscreen = FULLSCREEN_PATHS.has(item.path as string)

          return (
            <Route
              key={item.name || item.path}
              path={item.path}
              element={
                isFullscreen ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      height: '100vh',
                      minHeight: '100vh'
                    }}
                  >
                    <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>{item.element}</div>
                    <div style={{ minWidth: 0, minHeight: 0, display: 'flex' }}>
                      <AiAssistantPanel className="aiAssistantPanel" />
                    </div>
                  </div>
                ) : isDeviceProfile ? (
                  <StandaloneLayout>{item.element}</StandaloneLayout>
                ) : (
                  <MainLayout
                    currentApp={appPrefix}
                    appRoutes={processedAppRoutes}
                    headerRoutes={headerRoutes}
                    t={appT}
                  >
                    {item.element}
                  </MainLayout>
                )
              }
            />
          )
        })}
      </Routes>
    </>
  )
}

export default Router
