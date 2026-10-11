import { createBrowserRouter, Navigate } from 'react-router'
import { PageBody } from '@newt/ui/components/page-body'
import { SessionGuard } from './guards/session.guard'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes. Signing in and up, and recovering a password, are public; everything else is behind the
 * session guard. Every zone is lazy: its components, services and API arrive the
 * first time someone enters it, and the zone owns the routes below its path.
 */
export const router = createBrowserRouter([
  {
    path: '/sign-in',
    ErrorBoundary: RouteError,
    lazy: () => import('./pages/sign-in/sign-in').then(page => ({ Component: page.SignIn })),
  },
  {
    path: '/sign-up',
    ErrorBoundary: RouteError,
    lazy: () => import('./pages/sign-up/sign-up').then(page => ({ Component: page.SignUp })),
  },
  {
    path: '/forgot-password',
    ErrorBoundary: RouteError,
    lazy: () => import('./pages/forgot-password/forgot-password').then(page => ({ Component: page.ForgotPassword })),
  },
  {
    path: '/reset-password',
    ErrorBoundary: RouteError,
    lazy: () => import('./pages/reset-password/reset-password').then(page => ({ Component: page.ResetPassword })),
  },
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
          { path: 'workspaces', lazy: () => import('./pages/workspaces/workspaces').then(page => ({ Component: page.Workspaces })) },
          { path: 'workspaces/new', lazy: () => import('./pages/workspace-new/workspace-new').then(page => ({ Component: page.WorkspaceNew })) },
          { path: 'settings/*', lazy: () => import('./modules/settings/settings.routes').then(zone => ({ Component: zone.SettingsRoutes })) },
          {
            // Everything inside one workspace: only for its members.
            path: 'w/:workspaceId',
            lazy: () => import('./modules/workspace/workspace').then(zone => ({ Component: zone.Workspace })),
            children: [
              // A workspace opens on its definition, as a repository opens on its code.
              { index: true, element: <Navigate to="definition" replace /> },
              { path: 'definition/*', lazy: () => import('./modules/definition/definition.routes').then(zone => ({ Component: zone.DefinitionRoutes })) },
              { path: 'proposals/*', lazy: () => import('./modules/proposals/proposals.routes').then(zone => ({ Component: zone.ProposalsRoutes })) },
              { path: 'releases/*', lazy: () => import('./modules/releases/releases.routes').then(zone => ({ Component: zone.ReleasesRoutes })) },
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
