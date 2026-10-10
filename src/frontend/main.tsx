import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import '@newt/ui/styles/theme.css'
import { RouterLinkProvider } from '@newt/ui/components/router-link'
import { Toaster } from '@newt/ui/components/toast'
import { Requester } from '@newt/api/core/requester'
import { router } from './app.routes'
import { rootInjector } from './core/injector/root-injector'
import { SessionService } from './services/session/session.service'
import { ThemeService } from './services/theme/theme.service'

// The theme follows the stored choice from the first frame.
rootInjector.get(ThemeService)

// Whatever request finds the session gone sends the person back to sign in.
Requester.onUnauthorized = () => rootInjector.get(SessionService).expired()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterLinkProvider>
      <RouterProvider router={router} />
    </RouterLinkProvider>
    <Toaster />
  </StrictMode>,
)
