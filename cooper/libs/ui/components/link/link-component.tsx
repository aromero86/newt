import { createContext, type ComponentType, type ReactNode } from 'react'

/** What renders a link to another address: a plain `<a>`, or an app router's own link. */
export type LinkComponent = ComponentType<{
  href: string
  className?: string
  children?: ReactNode
  'aria-label'?: string
  'aria-current'?: 'page'
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
}>

function PlainLink({ href, children, ...rest }: React.ComponentProps<LinkComponent>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

/** The library's links render with this. A plain `<a>` unless the app provides its router's. */
export const LinkComponentContext = createContext<LinkComponent>(PlainLink)
