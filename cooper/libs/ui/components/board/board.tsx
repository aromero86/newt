import { useContext, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from 'cn'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Avatar } from 'newt-kit-react-ui/avatar'
import { LinkComponentContext } from 'newt-kit-react-ui/link'

/** What a dragged card carries: its id, under a type only boards read. */
const DRAG_TYPE = 'application/x-cooper-card'

/**
 * A board's columns side by side, scrolling sideways when they do not fit, like
 * a GitHub project's board view. It is `relative` so that what its cards place
 * absolutely (the `sr-only` text, say) scrolls inside it instead of widening the page.
 */
export function Board({ label, children }: { label: string, children: ReactNode }) {
  return (
    <section aria-label={label} className="relative flex min-h-0 flex-1 items-start gap-3 overflow-x-auto pb-2">
      {children}
    </section>
  )
}

type BoardColumnProps = {
  title: ReactNode
  /** How many cards it holds, beside the title. */
  count?: number
  /** A control at the end of the header: usually a `Menu`. */
  actions?: ReactNode
  /** Under the cards: usually the button that adds one. */
  footer?: ReactNode
  /**
   * A card was dropped on this column, with the `dragId` it was given. Without it
   * the column takes no drops. Dragging is a shortcut for the mouse: offer the same
   * move with the keyboard too (a card's menu).
   */
  onDropCard?: (dragId: string) => void
  /** The cards, as `BoardCard`s. */
  children?: ReactNode
}

/** One column of a board: a status that cards move through. */
export function BoardColumn({ title, count, actions, footer, onDropCard, children }: BoardColumnProps) {
  const [over, setOver] = useState(false)

  const dropProps = onDropCard
    ? {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
          setOver(false)
          const id = event.dataTransfer.getData(DRAG_TYPE)
          if (!id) return
          event.preventDefault()
          onDropCard(id)
        },
      }
    : {}

  return (
    <section
      className={cn(
        'flex max-h-full w-72 shrink-0 flex-col rounded-lg border bg-subtle transition-colors',
        over && 'border-brand bg-brand/5',
      )}
      {...dropProps}
    >
      <header className="flex h-10 items-center gap-2 px-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        {count !== undefined && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums">{count}</span>}
        {actions !== undefined && <div className="ml-auto flex items-center">{actions}</div>}
      </header>
      <div className="flex min-h-12 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
      {footer !== undefined && <div className="border-t px-2 py-1.5">{footer}</div>}
    </section>
  )
}

type BoardCardProps = {
  title: ReactNode
  /** Its short reference, such as `#12`. */
  reference?: ReactNode
  /** Small things under the title: badges, a due date. */
  meta?: ReactNode
  /** Who it is assigned to, shown as an avatar with the name as its tooltip. */
  assignee?: string
  /** Opens the card at this address. */
  href?: string
  /** Opens the card in place (a dialog). Ignored when `href` is given. */
  onOpen?: () => void
  /** A control at the top right, such as a `Menu` to move or delete it. */
  actions?: ReactNode
  /** Makes the card draggable onto a `BoardColumn` with `onDropCard`, which receives this id. */
  dragId?: string
}

/** One card on a board. */
export function BoardCard({ title, reference, meta, assignee, href, onOpen, actions, dragId }: BoardCardProps) {
  const Link = useContext(LinkComponentContext)
  const [dragging, setDragging] = useState(false)

  const titleClass = 'text-left text-sm font-medium text-foreground outline-none hover:text-brand hover:underline focus-visible:underline underline-offset-4 break-words'
  const heading = href !== undefined
    ? <Link href={href} className={titleClass}>{title}</Link>
    : onOpen !== undefined
      ? <button type="button" onClick={onOpen} className={titleClass}>{title}</button>
      : <span className="text-sm font-medium break-words">{title}</span>

  const dragProps = dragId !== undefined
    ? {
        draggable: true,
        onDragStart: (event: DragEvent) => {
          event.dataTransfer.setData(DRAG_TYPE, dragId)
          event.dataTransfer.effectAllowed = 'move'
          setDragging(true)
        },
        onDragEnd: () => setDragging(false),
      }
    : {}

  return (
    <article
      className={cn(
        'group flex flex-col gap-1.5 rounded-md border bg-card px-3 py-2 shadow-xs transition-colors focus-within:border-ring hover:border-muted-foreground/40',
        dragId !== undefined && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
      {...dragProps}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{heading}</div>
        {actions !== undefined && <div className="-mt-0.5 -mr-1.5 shrink-0">{actions}</div>}
      </div>
      {(reference !== undefined || meta !== undefined || assignee !== undefined) && (
        <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {reference !== undefined && <span className="font-mono">{reference}</span>}
          {meta}
          {assignee !== undefined && (
            <span className="ml-auto" title={assignee}>
              <span className="sr-only">Assigned to {assignee}</span>
              <Avatar name={assignee} size={5} />
            </span>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * What a board shows while it loads: grey columns with a few grey cards. Hidden from
 * screen readers: say that it is loading elsewhere, for example with a `Spinner`.
 */
export function BoardSkeleton({ columns = 3 }: { columns?: number }) {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 items-start gap-3 overflow-hidden pb-2">
      {Array.from({ length: columns }, (_, column) => (
        <div key={column} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-subtle p-2">
          <Skeleton height="sm" width="third" />
          {Array.from({ length: 3 - (column % 2) }, (_, card) => <Skeleton key={card} height="lg" />)}
        </div>
      ))}
    </div>
  )
}
