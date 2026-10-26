import type { ReactNode } from 'react'

type PageHeaderProps = {
  /** The page's main heading (h1). */
  title: ReactNode
  description?: ReactNode
  /** Buttons for the page, shown at the end of the header. */
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
