import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import '@newt/ui/styles/theme.css'
import { RouterLinkProvider } from '@newt/ui/components/router-link'
import { Toaster } from '@newt/ui/components/toast'
import { router } from './app.routes'
import { rootInjector } from './core/injector/root-injector'
import { ThemeService } from './services/theme/theme.service'

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
