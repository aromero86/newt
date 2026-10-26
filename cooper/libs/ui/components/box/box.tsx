import { useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { LinkComponentContext } from '../link/link-component'

/**
 * A bordered box of rows, like GitHub's lists: an optional header with counts and
 * filters, rows divided by a line, and an optional footer. The app's lists live in one.
 */
export function Box({ children, label }: { children: ReactNode, label?: string }) {
  return (
    <section aria-label={label} className="min-w-0 overflow-hidden rounded-md border bg-card text-sm">
      {children}
    </section>
  )
}

/** The box's top band: what is listed, how many, and its filters or actions at the end. */
export function BoxHeader({ children, actions }: { children: ReactNode, actions?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-subtle px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 font-medium">{children}</div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

type BoxRowProps = {
  /** What leads the row: a state icon, an avatar. */
  leading?: ReactNode
  /** What closes the row: counters, a menu. */
  trailing?: ReactNode
  /** Marks the row as the selected or highlighted one. */
  highlighted?: boolean
  children: ReactNode
}

/** One row of the box. */
export function BoxRow({ leading, trailing, highlighted = false, children }: BoxRowProps) {
  return (
    <div className={cn('flex min-h-12 items-center gap-3 border-b px-4 py-2.5 transition-colors last:border-b-0 hover:bg-accent/40', highlighted && 'bg-brand/5')}>
      {leading !== undefined && <div className="flex shrink-0 self-start pt-0.5">{leading}</div>}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing !== undefined && <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">{trailing}</div>}
    </div>
  )
}

/** The title of a row: a link that reads as text until pointed at. */
export function BoxRowTitle({ href, children }: { href?: string, children: ReactNode }) {
  const Link = useContext(LinkComponentContext)
  const look = 'font-semibold text-foreground'
  if (!href) return <span className={look}>{children}</span>
  return (
    <Link href={href} className={cn(look, 'outline-none hover:text-brand hover:underline focus-visible:underline underline-offset-4')}>
      {children}
    </Link>
  )
}

/** The small line under a row's title: key, who, when. */
export function BoxRowMeta({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{children}</div>
}

/** Content that is not a list, inside the box; several are divided by a line. `flush` drops the padding, for content that fills the box. */
export function BoxBody({ flush = false, children }: { flush?: boolean, children: ReactNode }) {
  return <div className={cn('border-b last:border-b-0', !flush && 'px-4 py-4')}>{children}</div>
}

const justifies = { center: 'justify-center', start: 'justify-start', between: 'justify-between', end: 'justify-end' }

/** The box's bottom band, for "load more" or actions. */
export function BoxFooter({ justify = 'center', children }: { justify?: keyof typeof justifies, children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-t bg-subtle px-4 py-2', justifies[justify])}>{children}</div>
}

/** What an empty box shows: why it is empty, and what to do. */
export function BoxEmpty({ icon: Glyph, title, description, action }: { icon?: React.ComponentType<{ className?: string }>, title: string, description?: string, action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Glyph && <Glyph aria-hidden className="mb-1 size-6 text-muted-foreground" />}
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  )
}

type BoxFilterProps = {
  active?: boolean
  icon?: React.ComponentType<{ className?: string }>
  count?: number
  onClick: () => void
  children: ReactNode
}

/** A filter in the box's header, like "3 Open · 5 Closed": the active one stands out. */
export function BoxFilter({ active = false, icon: Glyph, count, onClick, children }: BoxFilterProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground hover:text-foreground',
      )}
    >
      {Glyph && <Glyph aria-hidden className="size-4" />}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
      {children}
    </button>
  )
}
