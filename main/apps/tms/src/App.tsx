import { GlobalStyle } from '@repo/ui/styles'
import { useWindowDimensions } from '@repo/hooks'
import { useTranslation } from 'react-i18next'
import React, { Suspense, useEffect, useMemo } from 'react'
import { Routes, useLocation, Navigate } from 'react-router-dom'
import { Toast } from '@repo/ui'
import 'react-toastify/dist/ReactToastify.css'
import { clearChatRuleListCache } from '@repo/apis/ai/chatSettings.js'

import { useTaskFlowStore } from './store/taskflow.store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { flattenRoutes, appRoutes, getAppPrefix } from './router/routes'
import Router from './router/tms.router'
import { useOrganizationStore, useThemeStore } from '@repo/stores'
import { isDeviceProfile } from './common/profile'
import { DeviceOrgBootstrap } from './adapters/components/deviceOrgBootstrap'

const queryClient = new QueryClient()

function App() {
  useWindowDimensions()
  useThemeStore((state) => state.theme)
  const { pathname } = useLocation()
  const { t: layoutT } = useTranslation('layout')
  const { t: appT } = useTranslation('route')
  const refreshFlows = useTaskFlowStore((state) => state.refreshFlows)
  const appPrefix = useMemo(() => getAppPrefix(pathname), [pathname])
  const { selectedOrgs } = useOrganizationStore()
  useEffect(() => {
    refreshFlows(selectedOrgs[0], selectedOrgs[1])
  }, [refreshFlows])

  useEffect(() => {
    clearChatRuleListCache('tms')
  }, [pathname])

  const processedAppRoutes = useMemo(() => {
    const processRoutes = (routes: any) => {
      return routes.map((route: any) => {
        return {
          ...route,
          ...(route.depth && { depth: processRoutes(route.depth) })
        }
      })
    }

    return processRoutes(appRoutes)
  }, [])

  const allRoutes = useMemo(() => flattenRoutes(processedAppRoutes), [processedAppRoutes])
  const headerRoutes = useMemo(() => {
    return processedAppRoutes.map((route: any) => {
      return {
        name: route.name,
        path: route.path
      }
    })
  }, [processedAppRoutes])

  return (
    <>
      <QueryClientProvider client={queryClient}>
        <GlobalStyle />
        <Toast />
        <Suspense fallback={<div>{layoutT('loading')}</div>}>
          {isDeviceProfile ? (
            <DeviceOrgBootstrap>
              <Router
                allRoutes={allRoutes}
                appPrefix={appPrefix}
                processedAppRoutes={processedAppRoutes}
                headerRoutes={headerRoutes}
                appT={appT}
              />
            </DeviceOrgBootstrap>
          ) : (
            <Router
              allRoutes={allRoutes}
              appPrefix={appPrefix}
              processedAppRoutes={processedAppRoutes}
              headerRoutes={headerRoutes}
              appT={appT}
            />
          )}
        </Suspense>
      </QueryClientProvider>
    </>
  )
}

export default App

