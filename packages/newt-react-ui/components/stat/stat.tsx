import type { ReactNode } from 'react'

type StatProps = {
  /** What the number counts. */
  label: string
  /** A number, or one written already: `45 ms`. */
  value: number | string
  /** A short note under it: since when, of what. */
  hint?: ReactNode
}

/** One number that matters, large, with what it counts: a tile of an overview. */
export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{typeof value === 'number' ? value.toLocaleString('en') : value}</p>
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
