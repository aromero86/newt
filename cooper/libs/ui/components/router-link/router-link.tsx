import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { LinkProvider } from '../link/link-provider'
import type { LinkComponent } from '../link/link-component'

/** A library link that navigates with React Router instead of reloading the page. */
function RouterLink({ href, ...rest }: ComponentProps<LinkComponent>) {
  return <Link to={href} {...rest} />
}

/**
 * For apps on React Router: every link of the library navigates with it. Its own
 * folder, so an app without React Router (the landing) never loads it.
 */
export function RouterLinkProvider({ children }: { children: ReactNode }) {
  return <LinkProvider component={RouterLink}>{children}</LinkProvider>
}
