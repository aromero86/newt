import { createBrowserRouter } from 'react-router'
import { PageBody } from '@cooper/ui/components/page-body'
import { SessionGuard } from './guards/session.guard'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes, every one behind the session guard: signing in happens at auth,
 * and only the staff get in. Every zone is lazy: its components, services and API
 * arrive the first time someone enters it, and the zone owns the routes below its path.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: SessionGuard,
    ErrorBoundary: () => <PageBody><RouteError /></PageBody>,
    children: [
      {
        Component: Shell,
        children: [
          {
            // A failing page keeps the shell around it: the navigation still works.
            ErrorBoundary: RouteError,
            children: [
              { index: true, lazy: () => import('./modules/overview/overview').then(zone => ({ Component: zone.Overview })) },
              { path: 'workspaces/*', lazy: () => import('./modules/workspaces/workspaces.routes').then(zone => ({ Component: zone.WorkspacesRoutes })) },
              { path: 'users/*', lazy: () => import('./modules/users/users.routes').then(zone => ({ Component: zone.UsersRoutes })) },
              { path: 'staff', lazy: () => import('./modules/staff/staff').then(zone => ({ Component: zone.Staff })) },
              // Not lazy: the zones and the error page use it too, so it ships with the shell.
              { path: '*', Component: NotFound },
            ],
          },
        ],
      },
    ],
  },
])
