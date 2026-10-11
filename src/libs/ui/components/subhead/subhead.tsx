import type { ReactNode } from 'react'
import { cn } from 'cn'

type SubheadProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** `danger` for the section that can break things: archiving, leaving. */
  tone?: 'default' | 'danger'
}

/** The heading of a section of a page, over a line, with its actions at the end. */
export function Subhead({ title, description, actions, tone = 'default' }: SubheadProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b pb-3">
      <div className="min-w-0">
        <h2 className={cn('text-lg font-semibold tracking-tight', tone === 'danger' && 'text-bad')}>{title}</h2>
        {description !== undefined && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
