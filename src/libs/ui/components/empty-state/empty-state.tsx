import type { ReactNode } from 'react'
import type { IconComponent } from '../icon'

type EmptyStateProps = {
  icon?: IconComponent
  title: ReactNode
  description?: ReactNode
  /** What to do next, usually one `Button`. */
  action?: ReactNode
}

/** Fills a list or a page that has nothing to show yet. */
export function EmptyState({ icon: Glyph, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      {Glyph && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Glyph aria-hidden className="size-6" />
        </div>
      )}
      <h2 className="text-lg font-semibold">{title}</h2>
      {description !== undefined && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  )
}
