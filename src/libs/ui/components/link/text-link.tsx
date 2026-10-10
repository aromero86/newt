import { useContext, type ReactNode } from 'react'
import { LinkComponentContext } from './link-component'

/** A link inside text, to another address. */
export function TextLink({ href, children }: { href: string, children: ReactNode }) {
  const Link = useContext(LinkComponentContext)
  return (
    <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">
      {children}
    </Link>
  )
}
