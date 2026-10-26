import { createBrowserRouter } from 'react-router'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes: every page is a narrow card in the shell (sign in, sign up, the
 * consent an app asks for), and each one is lazy.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    ErrorBoundary: RouteError,
    // The shell is only a narrow column: a failing page replaces it, with its own.
    children: [
      { index: true, lazy: () => import('./pages/home/home').then(page => ({ Component: page.Home })) },
      { path: '*', Component: NotFound },
    ],
  },
])
