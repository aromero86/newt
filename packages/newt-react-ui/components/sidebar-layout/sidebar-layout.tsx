import { useId, useState, type MouseEvent, type ReactNode } from 'react'
import { cn } from 'cn'
import { ChevronDownIcon } from 'lucide-react'

type SidebarLayoutProps = {
  /** What sits beside the content. */
  aside: ReactNode
  /** `start` puts it on the left, like a settings menu; `end` on the right, like a pull request's sidebar. */
  side?: 'start' | 'end'
  /**
   * A menu at the start (`side="start"`), folded on narrow screens behind a button
   * with this text, the section you are in, say: the page starts with the content,
   * not with the whole menu. Following one of its links folds it again.
   */
  menuLabel?: string
  children: ReactNode
}

/** The content with a column beside it, one under the other on narrow screens. */
export function SidebarLayout({ aside, side = 'start', menuLabel, children }: SidebarLayoutProps) {
  return (
    <div className={cn('grid min-w-0 gap-6 lg:gap-8', side === 'start' ? 'md:grid-cols-[220px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_280px]')}>
      {side === 'start' && (menuLabel === undefined ? <aside className="min-w-0">{aside}</aside> : <FoldingAside label={menuLabel}>{aside}</FoldingAside>)}
      <div className="min-w-0">{children}</div>
      {side === 'end' && <aside className="min-w-0">{aside}</aside>}
    </div>
  )
}

/** The menu beside the content on wide screens; on narrow ones, behind a button. */
function FoldingAside({ label, children }: { label: string, children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()

  // A link followed: the page changes under it, so the menu gets out of the way.
  const onClick = (event: MouseEvent) => {
    if ((event.target as Element).closest('a')) setOpen(false)
  }

  return (
    <aside className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground motion-safe:transition-transform', open && 'rotate-180')} />
      </button>
      <div id={id} onClick={onClick} className={cn('mt-2 md:mt-0 md:block', !open && 'hidden')}>
        {children}
      </div>
    </aside>
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
