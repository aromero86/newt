import { createBrowserRouter } from 'react-router'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes. Every zone is lazy: its components, services and API arrive the
 * first time someone enters it, and the zone owns the routes below its path.
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
          { path: 'definition/*', lazy: () => import('./modules/definition/definition.routes').then(zone => ({ Component: zone.DefinitionRoutes })) },
          { path: 'proposals/*', lazy: () => import('./modules/proposals/proposals.routes').then(zone => ({ Component: zone.ProposalsRoutes })) },
          { path: 'releases/*', lazy: () => import('./modules/releases/releases.routes').then(zone => ({ Component: zone.ReleasesRoutes })) },
          // Not lazy: the zones and the error page use it too, so it ships with the shell.
          { path: '*', Component: NotFound },
        ],
      },
    ],
  },
])
