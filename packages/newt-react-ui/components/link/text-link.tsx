import { useContext, type ReactNode } from 'react'
import { LinkComponentContext } from './link-component'

const CLASS = 'font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none'

/**
 * A link inside text, to another address. `external`: to another site, in a tab of its
 * own, never through the app's router.
 */
export function TextLink({ href, external = false, children }: { href: string, external?: boolean, children: ReactNode }) {
  const Link = useContext(LinkComponentContext)
  if (external) return <a href={href} target="_blank" rel="noreferrer" className={CLASS}>{children}</a>
  return (
    <Link href={href} className={CLASS}>
      {children}
    </Link>
  )
}
