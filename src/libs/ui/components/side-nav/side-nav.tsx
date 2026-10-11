import { useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { LinkComponentContext } from '../link/link-component'
import type { IconComponent } from '../icon'

/** The menu at the side of a settings page: one link per section. */
export function SideNav({ label, children }: { label: string, children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5 text-sm">
      {children}
    </nav>
  )
}

/** A heading that groups the links below it. */
export function SideNavHeading({ children }: { children: ReactNode }) {
  return <p className="mt-4 mb-1 px-3 text-xs font-medium text-muted-foreground first:mt-0">{children}</p>
}

export function SideNavItem({ href, active = false, icon: Glyph, children }: { href: string, active?: boolean, icon?: IconComponent, children: ReactNode }) {
  const Link = useContext(LinkComponentContext)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-3 py-1.5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-accent font-medium text-foreground before:absolute before:inset-y-1.5 before:-left-2 before:w-1 before:rounded-full before:bg-brand' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {Glyph && <Glyph aria-hidden className="size-4 shrink-0" />}
      {children}
    </Link>
  )
}
