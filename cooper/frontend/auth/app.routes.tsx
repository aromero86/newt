import { createBrowserRouter } from 'react-router'
import { Spinner } from '@newt-kit/react-ui/spinner'
import { NotFound } from './pages/not-found/not-found'
import { RouteError } from './pages/route-error/route-error'
import { Shell } from './pages/shell/shell'

/**
 * The top routes: every page is a narrow card in the shell, and each one is lazy.
 * Signing in and up keep the authorization request the person came with
 * (`?authorization=<id>`); `/authorize/:id` is where auth's `/oauth/authorize` sends
 * the browser, and `/error` where it shows a request it cannot answer.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    ErrorBoundary: RouteError,
    // The shell is only a narrow column: a failing page replaces it, with its own.
    children: [
      {
        // The first page's code is still downloading: the shell shows, with a spinner in the page's place.
        HydrateFallback: () => <Spinner label="Loading" />,
        children: [
          { index: true, lazy: () => import('./pages/home/home').then(page => ({ Component: page.Home })) },
          { path: 'sign-in', lazy: () => import('./pages/sign-in/sign-in').then(page => ({ Component: page.SignIn })) },
          { path: 'sign-up', lazy: () => import('./pages/sign-up/sign-up').then(page => ({ Component: page.SignUp })) },
          { path: 'authorize/:id', lazy: () => import('./pages/authorize/authorize').then(page => ({ Component: page.Authorize })) },
          { path: 'error', lazy: () => import('./pages/oauth-error/oauth-error').then(page => ({ Component: page.OauthError })) },
          { path: '*', Component: NotFound },
        ],
      },
    ],
  },
])
