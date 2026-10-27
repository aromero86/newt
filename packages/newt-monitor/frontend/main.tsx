import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { RouterLinkProvider } from 'newt-react-ui/router-link'
import { Toaster } from 'newt-react-ui/toast'
import { rootInjector, ThemeService } from 'newt-react'
import { router } from './app.routes'

// The theme follows the stored choice from the first frame.
rootInjector.get(ThemeService)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterLinkProvider>
      <RouterProvider router={router} />
    </RouterLinkProvider>
    <Toaster />
  </StrictMode>,
)
