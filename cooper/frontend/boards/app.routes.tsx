import { createBrowserRouter, Navigate } from 'react-router'
import { PageBody } from '@cooper/ui/components/page-body'
import { SessionGuard } from './guards/session.guard'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes, every one behind the session guard: signing in happens at auth.
 * Every zone is lazy: its components, services and API arrive the first time someone
 * enters it, and the zone owns the routes below its path.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: SessionGuard,
    ErrorBoundary: RouteError,
    children: [
      {
        Component: Shell,
        children: [
          {
            // A failing page keeps the shell around it: the navigation still works.
            ErrorBoundary: RouteError,
            children: [
              { index: true, lazy: () => import('./pages/home/home').then(page => ({ Component: page.Home })) },
              { path: 'workspaces/new', lazy: () => import('./pages/workspace-new/workspace-new').then(page => ({ Component: page.WorkspaceNew })) },
              { path: 'invitations/:token', lazy: () => import('./pages/invitation/invitation').then(page => ({ Component: page.Invitation })) },
              {
                // Everything inside one workspace: only for its members.
                path: 'w/:workspaceId',
                lazy: () => import('./modules/workspace/workspace').then(zone => ({ Component: zone.Workspace })),
                children: [
                  // A workspace opens on its boards.
                  { index: true, element: <Navigate to="boards" replace /> },
                  { path: 'boards/*', lazy: () => import('./modules/boards/boards.routes').then(zone => ({ Component: zone.BoardsRoutes })) },
                  { path: 'search', lazy: () => import('./modules/search/search').then(zone => ({ Component: zone.Search })) },
                  { path: 'settings/*', lazy: () => import('./modules/workspace-settings/workspace-settings').then(zone => ({ Component: zone.WorkspaceSettings })) },
                ],
              },
              // Not lazy: the zones and the error page use it too, so it ships with the shell.
              { path: '*', element: <PageBody><NotFound /></PageBody> },
            ],
          },
        ],
      },
    ],
  },
])
