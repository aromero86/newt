import type { ComponentType, ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../internal/tooltip'
import { TextLink } from '../link'

export type WaterfallTone = 'brand' | 'ok' | 'warn' | 'bad' | 'muted'

/** One step: how deep it is (0, the first), what it is, and when it started and how long it took, from the first's start. */
export type WaterfallRow = {
  id: string
  depth: number
  label: ReactNode
  /** What it says beside its name, smaller: the rows a query read, its shape. */
  detail?: ReactNode
  startMs: number
  /** 0 with `instant`: a moment, drawn as a mark. */
  ms: number
  tone?: WaterfallTone
  /** A moment, not a step: an event told. */
  instant?: boolean
  /** What kind of step it is, before its name: a use case's. */
  icon?: ComponentType<{ className?: string }>
  /** Since when it waited before it started, drawn dotted: a job in its queue. */
  waitFromMs?: number
  /** Steps of its own it can show: shown or not, and how to switch. */
  expandable?: { expanded: boolean, onToggle: () => void, label: string }
  /** Where it is whole, as a link beside its name. */
  link?: { href: string, label: string }
  /** Stands out: the one the page is about. */
  highlighted?: boolean
  /** Moments on its line, each a dot of its tone that says what it is when pointed at: the log lines written in a step. */
  marks?: WaterfallMark[]
}

/** A moment on a row's line: when, its tone, and what it says (its tooltip, and its name to a screen reader). */
export type WaterfallMark = { id: string, atMs: number, tone: WaterfallTone, label: string }

const barClass: Record<WaterfallTone, string> = {
  brand: 'bg-brand',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  muted: 'bg-muted-foreground/40',
}

const markClass: Record<WaterfallTone, string> = {
  brand: 'border-brand',
  ok: 'border-ok',
  warn: 'border-warn',
  bad: 'border-bad',
  muted: 'border-muted-foreground',
}

const defaultFormat = (ms: number) => (ms < 1000 ? `${ms.toLocaleString('en', { maximumFractionDigits: ms < 10 ? 1 : 0 })} ms` : `${(ms / 1000).toLocaleString('en', { maximumFractionDigits: 2 })} s`)

/**
 * Steps on a timeline, each inside the one above it, as GitHub shows a job's steps:
 * its name indented by how deep it is, and a bar from when it started for as long as it
 * took; a moment as a mark, a wait before a step dotted, and moments in a step (its
 * log lines) as dots that say what they are when pointed at. A row may unfold steps of
 * its own and link to where it is whole. Pressing a row selects it (`onSelect`).
 */
export function Waterfall({ label, rows, totalMs, formatMs = defaultFormat, selected, onSelect }: {
  label: string
  rows: WaterfallRow[]
  /** The whole timeline: as far as its rows reach, unless told. */
  totalMs?: number
  formatMs?: (ms: number) => string
  selected?: string | null
  onSelect?: (id: string) => void
}) {
  const total = Math.max(totalMs ?? Math.max(...rows.map(row => row.startMs + row.ms), 0), 0.001)
  const percent = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`
  // Its time after its bar; before it when the bar ends near the right; on its end when it fills the line.
  const placement = (row: WaterfallRow) => (row.startMs + row.ms <= total * 0.8 ? 'after' : row.startMs >= total * 0.2 ? 'before' : 'inside')
  const labelStyle = (row: WaterfallRow) => {
    const where = placement(row)
    if (where === 'after') return { left: `calc(${percent(row.startMs + row.ms)} + 6px)` }
    if (where === 'before') return { right: `calc(100% - ${percent(row.startMs)} + 6px)` }
    return { right: `calc(100% - ${percent(row.startMs + row.ms)} + 6px)` }
  }

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
        const tone = row.tone ?? 'brand'
        const name = (
          <>
            <span className="truncate font-mono text-[13px] text-foreground">{row.label}</span>
            {row.detail && <span className="truncate text-xs text-muted-foreground">{row.detail}</span>}
          </>
        )
        return (
          <div
            role="listitem"
            key={row.id}
            className={`border-b border-border px-4 py-1.5 last:border-b-0 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-center md:gap-4 ${isSelected ? 'bg-muted' : row.highlighted ? 'bg-brand/10' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${row.depth * 16}px` }}>
              {row.expandable
                ? (
                    <button type="button" aria-expanded={row.expandable.expanded} aria-label={row.expandable.label} onClick={row.expandable.onToggle} className="-ml-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
                      {row.expandable.expanded ? <ChevronDownIcon aria-hidden className="size-4" /> : <ChevronRightIcon aria-hidden className="size-4" />}
                    </button>
                  )
                : row.instant
                  ? <span aria-hidden className={`ml-0.5 size-2 shrink-0 rotate-45 border-2 ${markClass[tone]}`} />
                  : row.icon && <row.icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
              {onSelect
                ? <button type="button" aria-pressed={isSelected} onClick={() => onSelect(row.id)} className="flex min-w-0 cursor-pointer items-baseline gap-2 rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-brand">{name}</button>
                : <span className="flex min-w-0 items-baseline gap-2">{name}</span>}
              {row.link && <span className="shrink-0 text-xs"><TextLink href={row.link.href}>{row.link.label}</TextLink></span>}
            </span>
            <span className="relative mt-1 flex h-5 items-center md:mt-0">
              {row.waitFromMs !== undefined && row.waitFromMs < row.startMs && (
                <span aria-hidden className="absolute inset-y-[9px] border-t border-dashed border-muted-foreground/60" style={{ left: percent(row.waitFromMs), width: percent(row.startMs - row.waitFromMs) }} />
              )}
              {row.instant
                ? <span aria-hidden className={`absolute size-2.5 -translate-x-1/2 rotate-45 border-2 bg-card ${markClass[tone]}`} style={{ left: percent(row.startMs) }} />
                : (
                    <span className="absolute inset-y-1.5 rounded-sm" style={{ left: percent(row.startMs), width: `max(2px, ${percent(row.ms)})` }}>
                      <span className={`block h-full rounded-sm ${barClass[tone]}`} />
                    </span>
                  )}
              {row.marks?.map(mark => (
                <Tooltip key={mark.id}>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label={mark.label} onClick={() => onSelect?.(row.id)} className={`absolute z-10 size-2.5 -translate-x-1/2 cursor-pointer rounded-full border-2 border-card ${barClass[mark.tone]} hover:scale-125 focus-visible:outline-2 focus-visible:outline-brand`} style={{ left: percent(mark.atMs) }} />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm font-mono break-words whitespace-pre-wrap">{mark.label}</TooltipContent>
                </Tooltip>
              ))}
              {!row.instant && (
                <span className={`absolute text-xs whitespace-nowrap text-muted-foreground tabular-nums ${placement(row) === 'inside' || row.waitFromMs !== undefined ? 'rounded-sm bg-card px-1' : ''}`} style={labelStyle(row)}>
                  {formatMs(row.ms)}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
