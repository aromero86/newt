import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import '@cooper/ui/styles/theme.css'
import { RouterLinkProvider } from '@cooper/ui/components/router-link'
import { Toaster } from '@cooper/ui/components/toast'
import { rootInjector } from '@cooper/core/injector/root-injector'
import { ThemeService } from '@cooper/core/theme/theme.service'
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
