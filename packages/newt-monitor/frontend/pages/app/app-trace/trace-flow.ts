import { PlayIcon } from 'lucide-react'
import type { WaterfallMark, WaterfallRow, WaterfallTone } from '@newt-kit/react-ui/waterfall'
import type { TraceDTO, TraceSummaryDTO } from '../../../api/traces'
import { formatMs } from '../app-metrics/metrics-format'

export type Span = TraceDTO['spans'][number]
export type LogLine = TraceDTO['logs'][number]

/** A log line's tone, by how much it matters. */
export const LOG_TONES: Record<LogLine['level'], WaterfallTone> = { debug: 'muted', info: 'brand', warn: 'warn', error: 'bad' }

/**
 * The rows of a flow, from the trace on top: each trace's spans under the one they ran
 * in, and under each event told, the runs of the jobs it caused, at their own time, with
 * how long they waited dotted. A run unfolded shows its steps, a run folded only itself.
 * Each step's log lines are dots on its line.
 * Every row's id is `<trace id>:<span id>`; the timeline starts at the top trace's start.
 */
export function flowRows(flow: { appId: string, top: TraceDTO, focus: string, traces: Record<string, TraceDTO>, unfolded: string[], loading: string[], toggle: (traceId: string) => void }): WaterfallRow[] {
  const origin = Date.parse(flow.top.startedAt)
  const rows: WaterfallRow[] = []

  /** A trace's spans, from `parentId` down, `depth` deep, at its own start on the timeline. */
  const walk = (trace: TraceDTO, parentId: string | null, depth: number, offset: number) => {
    const children = trace.spans.filter(span => span.parentId === parentId).toSorted((a, b) => a.startMs - b.startMs)
    for (const span of children) {
      // A job's root, when it hangs from the event that caused it, is the row the run folded is.
      if (span.parentId === null && trace.id !== flow.top.id) {
        walk(trace, span.id, depth, offset)
        continue
      }
      rows.push({
        id: `${trace.id}:${span.id}`, depth, label: span.name, detail: detailOf(span), startMs: offset + span.startMs, ms: span.ms, tone: toneOf(span),
        instant: span.kind === 'event', icon: span.kind === 'use-case' ? PlayIcon : undefined, iconTone: 'ok', highlighted: span.parentId === null && trace.id === flow.focus && flow.top.id !== flow.focus,
        marks: marksOf(trace, span.id, offset),
      })
      walk(trace, span.id, depth + 1, offset)
      if (span.kind === 'event') for (const run of trace.caused.filter(each => each.job?.eventId === span.attributes.eventId)) runRow(run, depth + 1, offset + span.startMs)
    }
  }

  /** A job's run under the event that caused it: folded, itself; unfolded, its steps under it. */
  const runRow = (run: TraceSummaryDTO, depth: number, toldAt: number) => {
    const unfolded = flow.unfolded.includes(run.id) && flow.traces[run.id]
    const loading = flow.loading.includes(run.id)
    const root = flow.traces[run.id]?.spans.find(span => span.parentId === null)
    rows.push({
      id: `${run.id}:${root?.id ?? '1'}`, depth, label: run.name,
      detail: [`run ${run.job!.run}`, run.outcome?.code, loading ? 'loading…' : null].filter(Boolean).join(' · '),
      startMs: Date.parse(run.startedAt) - origin, ms: run.ms, waitFromMs: toldAt,
      tone: run.outcome?.kind === 'failure' ? 'bad' : run.outcome?.kind === 'error' ? 'warn' : 'ok',
      expandable: { expanded: Boolean(unfolded), onToggle: () => flow.toggle(run.id), label: `${unfolded ? 'Hide' : 'Show'} the steps of ${run.name}, run ${run.job!.run}` },
      link: { href: `/apps/${flow.appId}/traces/${run.id}`, label: 'Open' },
      highlighted: run.id === flow.focus,
      marks: flow.traces[run.id] && root ? marksOf(flow.traces[run.id]!, root.id, Date.parse(run.startedAt) - origin) : undefined,
    })
    if (unfolded) walk(flow.traces[run.id]!, null, depth + 1, Date.parse(run.startedAt) - origin)
  }

  walk(flow.top, null, 0, 0)
  return rows
}

/** A step's log lines, as dots at their time: each says its level, its message and its fields. */
function marksOf(trace: TraceDTO, spanId: string, offset: number): WaterfallMark[] | undefined {
  const lines = trace.logs.filter(line => line.spanId === spanId)
  if (lines.length === 0) return undefined
  return lines.map((line, index) => ({ id: `${trace.id}:log:${spanId}:${index}`, atMs: offset + line.atMs, tone: LOG_TONES[line.level], label: describeLog(line) }))
}

/** A log line as one text: `warn: slow board {"boardId":"b-1"}`. */
export function describeLog(line: LogLine): string {
  return `${line.level}: ${line.message}${Object.keys(line.fields).length ? ` ${JSON.stringify(line.fields)}` : ''}`
}

function detailOf(span: Span): string | undefined {
  if (span.kind === 'query') return [span.attributes.query, span.attributes.rows !== undefined ? `${span.attributes.rows} rows` : null].filter(Boolean).join(' · ') || undefined
  if (span.kind === 'transaction' && span.attributes.commitMs !== undefined) return `commit ${formatMs(Number(span.attributes.commitMs))}`
  if (span.kind === 'use-case') return [span.context, span.attributes.runs ? `ran ${span.attributes.runs} times` : null].filter(Boolean).join(' · ')
  if (span.kind === 'event') return 'told'
  if (span.kind === 'rate-limit') return span.outcome ? 'refused' : `${span.attributes.remaining} of ${span.attributes.limit} left`
  if (span.outcome) return span.outcome.code
  return undefined
}

function toneOf(span: Span): WaterfallTone {
  if (span.outcome?.kind === 'failure') return 'bad'
  if (span.outcome?.kind === 'error') return 'warn'
  if (span.kind === 'query' || span.kind === 'transaction' || span.kind === 'rate-limit') return 'muted'
  if (span.kind === 'use-case' || span.kind === 'attempt' || span.kind === 'event') return 'brand'
  return 'ok'
}
