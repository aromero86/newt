import { createBrowserRouter } from 'react-router'
import { PageBody } from 'newt-react-ui/page-body'
import { Spinner } from 'newt-react-ui/spinner'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The monitor's routes, inside its shell. Every zone is lazy: its components, services
 * and API arrive the first time someone enters it.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    ErrorBoundary: () => <PageBody><RouteError /></PageBody>,
    children: [
      {
        // A failing page keeps the shell around it: the bar still works.
        ErrorBoundary: RouteError,
        // The first page's code is still downloading: the shell shows, with a spinner in the page's place.
        HydrateFallback: () => <Spinner label="Loading page" />,
        children: [
          { index: true, lazy: () => import('./pages/apps/apps').then(page => ({ Component: page.Apps })) },
          // Not lazy: the zones and the error page use it too, so it ships with the shell.
          { path: '*', Component: NotFound },
        ],
      },
    ],
  },
])
