import type { ReactNode } from 'react'
import { LinkComponentContext, type LinkComponent } from './link-component'

/**
 * Makes every link of the library navigate with the app's router instead of
 * reloading the page. Render it once, around the app.
 */
export function LinkProvider({ component, children }: { component: LinkComponent, children: ReactNode }) {
  return <LinkComponentContext.Provider value={component}>{children}</LinkComponentContext.Provider>
}
