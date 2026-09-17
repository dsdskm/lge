import DeployPage from '@/pages/DeployPage'
import RobotDetailPage from '@/pages/RobotDetailPage'
import RobotsPage from '@/pages/RobotsPage'
import TaskFlowCanvasPage from '@/pages/TaskFlowCanvasPage'
import TaskFlowListDetailPage from '@/pages/TaskFlowListDetailPage'
import TaskFlowListPage from '@/pages/TaskFlowListPage'
import { isDeviceProfile } from '@/common/profile'
import { Navigate } from 'react-router-dom'
import { SHOW_TASK_MANAGEMENT } from '@/common/featureFlags'
import ActionListPage from '@/pages/ActionListPage'
import ActionDetailPage from '@/pages/ActionDetailPage'

export const appRoutes = [
  {
    name: 'taskflows',
    path: '/tms/taskflows',
    prefix: 'tms',
    icon: 'dashboard',
    element: <TaskFlowListPage />,
    depth: [
      {
        name: 'taskflowDetail',
        hide: true,
        hasBack: true,
        path: '/tms/taskflows/:taskFlowId/detail',
        prefix: 'tms',
        element: <TaskFlowListDetailPage />,
        depth: [
          {
            name: 'deploy',
            hide: true,
            hasBack: true,
            path: '/tms/taskflows/:taskFlowId/detail/deploy',
            prefix: 'tms',
            element: <DeployPage />
          }
        ]
      },
      {
        name: 'taskflowCanvas',
        hide: true,
        hasBack: true,
        path: '/tms/taskflows/:taskFlowId/canvas',
        prefix: 'tms',
        element: <TaskFlowCanvasPage />
      }
    ],
    accessLevel: [0, 1, 2, 3]
  },

  {
    name: 'robots',
    path: '/tms/robots',
    prefix: 'tms',
    icon: 'robot',
    element: <RobotsPage />,
    depth: [
      {
        name: 'robotDetail',
        hide: true,
        hasBack: !isDeviceProfile,
        path: '/tms/robots/:robotId/detail',
        prefix: 'tms',
        element: <RobotDetailPage />
      }
    ],
    accessLevel: [0, 1, 2, 3]
  },
  /*
    Task 관리 노출 여부(SHOW_TASK_MANAGEMENT). 점검 모드의 AST 뷰와 같은 기준을 쓴다.
    여기서 빼면 GNB 메뉴와 라우트가 함께 사라진다 — 둘 다 appRoutes 에서 나온다.
  */
  ...(SHOW_TASK_MANAGEMENT
    ? [
        {
          name: 'actions',
          path: '/tms/actions',
          prefix: 'tms',
          icon: 'category',
          element: <ActionListPage />,
          depth: [
            {
              // 신규 추가(/tms/actions/new/detail)도 같은 화면을 편집 모드로 재사용한다.
              name: 'actionDetail',
              hide: true,
              hasBack: true,
              path: '/tms/actions/:actionId/detail',
              prefix: 'tms',
              element: <ActionDetailPage />
            }
          ],
          accessLevel: [0, 1, 2, 3]
        }
      ]
    : [])
]

export const getAppPrefix = (pathname: string) => {
  return pathname.split('/').filter(Boolean)[0] || 'setup'
}

export const flattenRoutes = (routes: any) => {
  let result: any = []
  routes.forEach((route: any) => {
    result.push(route)
    if (route.depth) {
      result = [...result, ...flattenRoutes(route.depth)]
    }
  })
  // Root redirect
  if (!result.find((r: any) => r.path === '/')) {
    result.push({
      name: '',
      path: '/tms',
      prefix: '',
      element: <Navigate to={isDeviceProfile ? '/tms/robots/self/detail' : '/tms/taskflows'} replace />
    })
  }
  return result
}
