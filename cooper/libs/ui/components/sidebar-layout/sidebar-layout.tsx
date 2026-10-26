import type { ReactNode } from 'react'
import { cn } from 'cn'

type SidebarLayoutProps = {
  /** What sits beside the content. */
  aside: ReactNode
  /** `start` puts it on the left, like a settings menu; `end` on the right, like a pull request's sidebar. */
  side?: 'start' | 'end'
  children: ReactNode
}

/** The content with a column beside it, one under the other on narrow screens. */
export function SidebarLayout({ aside, side = 'start', children }: SidebarLayoutProps) {
  return (
    <div className={cn('grid min-w-0 gap-6 lg:gap-8', side === 'start' ? 'md:grid-cols-[220px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_280px]')}>
      {side === 'start' && <aside className="min-w-0">{aside}</aside>}
      <div className="min-w-0">{children}</div>
      {side === 'end' && <aside className="min-w-0">{aside}</aside>}
    </div>
  )
}

/** One section of a sidebar: a small title over a line, and its content. */
export function SidebarSection({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section className="border-b py-4 text-sm first:pt-0 last:border-b-0">
      <h2 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}
