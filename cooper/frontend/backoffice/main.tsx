import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { RouterLinkProvider } from 'newt-react-ui/router-link'
import { Toaster } from 'newt-react-ui/toast'
import { Requester, rootInjector, ThemeService } from 'newt-react'
import { router } from './app.routes'
import { SessionService } from './services/session/session.service'

// The theme follows the stored choice from the first frame.
rootInjector.get(ThemeService)

// Whatever request finds the session gone shows the way to sign in again.
Requester.onUnauthorized = () => rootInjector.get(SessionService).expired()

// Whatever request finds its person no longer of the staff shows them the way out.
// Other refusals are the page's own to show.
Requester.onForbidden = (error) => {
  if (error.code === 'staff.not_staff') rootInjector.get(SessionService).refused()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterLinkProvider>
      <RouterProvider router={router} />
    </RouterLinkProvider>
    <Toaster />
  </StrictMode>,
)
