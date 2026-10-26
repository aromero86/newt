import { useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { LinkComponentContext } from '../link/link-component'

type NavItemProps = {
  href: string
  /** The page being shown is this item's. */
  active?: boolean
  children: ReactNode
}

/** An item of the main navigation: marks the zone you are in. */
export function NavItem({ href, active = false, children }: NavItemProps) {
  const Link = useContext(LinkComponentContext)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}
