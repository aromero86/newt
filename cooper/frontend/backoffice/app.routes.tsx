import { createBrowserRouter } from 'react-router'
import { PageBody } from '@cooper/ui/components/page-body'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes: the shell, and one lazy route per zone below it, so a zone's
 * components, services and API arrive the first time someone enters it. The zone
 * owns the routes below its path (`{ path: 'workspaces/*', lazy: … }`).
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    ErrorBoundary: RouteError,
    children: [
      {
        // A failing page keeps the shell around it: the navigation still works.
        ErrorBoundary: RouteError,
        children: [
          { index: true, lazy: () => import('./pages/home/home').then(page => ({ Component: page.Home })) },
          // Not lazy: the zones and the error page use it too, so it ships with the shell.
          { path: '*', element: <PageBody><NotFound /></PageBody> },
        ],
      },
    ],
  },
])
