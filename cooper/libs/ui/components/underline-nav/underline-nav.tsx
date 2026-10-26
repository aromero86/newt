import { useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { LinkComponentContext } from '../link/link-component'
import type { IconComponent } from '../icon'

/** Tabs that are links, underlined like GitHub's: each one a part of the same thing. */
export function UnderlineNav({ label, children }: { label: string, children: ReactNode }) {
  return (
    <nav aria-label={label} className="-mb-px flex min-w-0 gap-1 overflow-x-auto">
      {children}
    </nav>
  )
}

type UnderlineNavItemProps = {
  href: string
  active?: boolean
  icon?: IconComponent
  /** A number shown after the label: open proposals, releases. */
  count?: number
  children: ReactNode
}

export function UnderlineNavItem({ href, active = false, icon: Glyph, count, children }: UnderlineNavItemProps) {
  const Link = useContext(LinkComponentContext)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2 border-b-2 px-3 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:text-foreground',
        active ? 'border-brand font-medium text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {Glyph && <Glyph aria-hidden className="size-4 opacity-80" />}
      {children}
      {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums">{count}</span>}
    </Link>
  )
}
