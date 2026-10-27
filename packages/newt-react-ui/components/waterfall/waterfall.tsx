import type { ReactNode } from 'react'

export type WaterfallTone = 'brand' | 'ok' | 'warn' | 'bad' | 'muted'

/** One step: how deep it is (0, the first), what it is, and when it started and how long it took, from the first's start. */
export type WaterfallRow = {
  id: string
  depth: number
  label: ReactNode
  /** What it says beside its name, smaller: the rows a query read, its shape. */
  detail?: ReactNode
  startMs: number
  ms: number
  tone?: WaterfallTone
}

const barClass: Record<WaterfallTone, string> = {
  brand: 'bg-brand',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  muted: 'bg-muted-foreground/40',
}

const defaultFormat = (ms: number) => (ms < 1000 ? `${ms.toLocaleString('en', { maximumFractionDigits: ms < 10 ? 1 : 0 })} ms` : `${(ms / 1000).toLocaleString('en', { maximumFractionDigits: 2 })} s`)

/**
 * Steps on a timeline, each inside the one above it, as GitHub shows a job's steps:
 * its name indented by how deep it is, and a bar from when it started for as long as it
 * took. Pressing a row selects it (`onSelect`), for the page to say more of it.
 */
export function Waterfall({ label, rows, totalMs, formatMs = defaultFormat, selected, onSelect }: {
  label: string
  rows: WaterfallRow[]
  /** The whole timeline: the first's time, unless told. */
  totalMs?: number
  formatMs?: (ms: number) => string
  selected?: string | null
  onSelect?: (id: string) => void
}) {
  const total = Math.max(totalMs ?? Math.max(...rows.map(row => row.startMs + row.ms), 0), 0.001)
  const percent = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`

  return (
    <div role="list" aria-label={label} className="text-sm">
      <div aria-hidden="true" className="hidden border-b border-border px-4 py-1.5 text-xs text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-4">
        <span>Step</span>
        <span className="flex justify-between tabular-nums">
          {[0, 0.25, 0.5, 0.75, 1].map(share => <span key={share}>{formatMs(total * share)}</span>)}
        </span>
      </div>
      {rows.map(row => {
        const isSelected = row.id === selected
        const content = (
          <>
            <span className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: `${row.depth * 16}px` }}>
              <span className="truncate font-mono text-[13px] text-foreground">{row.label}</span>
              {row.detail && <span className="truncate text-xs text-muted-foreground">{row.detail}</span>}
            </span>
            <span className="relative mt-1 flex h-5 items-center md:mt-0">
              <span className="absolute inset-y-1.5 rounded-sm" style={{ left: percent(row.startMs), width: `max(2px, ${percent(row.ms)})` }}>
                <span className={`block h-full rounded-sm ${barClass[row.tone ?? 'brand']}`} />
              </span>
              <span className="absolute text-xs text-muted-foreground tabular-nums" style={row.startMs + row.ms > total * 0.8 ? { right: `calc(100% - ${percent(row.startMs)} + 6px)` } : { left: `calc(${percent(row.startMs + row.ms)} + 6px)` }}>
                {formatMs(row.ms)}
              </span>
            </span>
          </>
        )
        const rowClass = `block w-full border-b border-border px-4 py-1.5 text-left last:border-b-0 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-center md:gap-4 ${isSelected ? 'bg-muted' : ''}`
        return (
          <div role="listitem" key={row.id}>
            {onSelect
              ? <button type="button" aria-pressed={isSelected} onClick={() => onSelect(row.id)} className={`${rowClass} cursor-pointer hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`}>{content}</button>
              : <div className={rowClass}>{content}</div>}
          </div>
        )
      })}
    </div>
  )
}
