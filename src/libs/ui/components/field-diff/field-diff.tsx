import type { ReactNode } from 'react'
import { cn } from 'cn'

/** One field that changed: what it said and what it says; either may be missing. */
export type FieldDiffRow = { label: string, before?: ReactNode, after?: ReactNode }

/**
 * Fields that changed, as a diff: the old value in red, the new in green, each
 * under the field's name. A field only added or only removed shows one line, and
 * one with nothing on either side is left out. `flush` drops its own border, to
 * fill a box edge to edge like a file's diff.
 */
export function FieldDiff({ rows, label, flush = false }: { rows: FieldDiffRow[], label: string, flush?: boolean }) {
  const shown = rows.filter(row => row.before !== undefined || row.after !== undefined)
  if (shown.length === 0) return null
  return (
    <dl aria-label={label} className={cn('overflow-hidden text-sm', !flush && 'rounded-md border')}>
      {shown.map((row, index) => (
        <div key={index} className="grid border-b last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="bg-subtle px-3 py-2 text-xs font-medium text-muted-foreground sm:border-r">{row.label}</dt>
          <dd className="min-w-0 font-normal">
            {row.before !== undefined && (
              <div className="flex gap-2 bg-bad/8 px-3 py-1.5 text-foreground/80">
                <span aria-hidden className="shrink-0 font-mono text-bad select-none">−</span>
                <span className="sr-only">Before: </span>
                <div className="min-w-0">{row.before}</div>
              </div>
            )}
            {row.after !== undefined && (
              <div className="flex gap-2 bg-ok/8 px-3 py-1.5">
                <span aria-hidden className="shrink-0 font-mono text-ok select-none">+</span>
                <span className="sr-only">After: </span>
                <div className="min-w-0">{row.after}</div>
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
