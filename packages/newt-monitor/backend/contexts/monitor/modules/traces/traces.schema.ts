import type { Outcome, Trace } from 'newt/contract'
import { z } from 'zod'
import { WINDOWS, type MetricsWindow } from '../event-metrics/event-metrics.schema'

/** What the monitor has collected of an application's traces: up to which minute. */
export const TracesFeedSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The last minute collected: the next collection asks from it. Null before the first. */
  until: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type TracesFeedDTO = z.infer<typeof TracesFeedSchema>

/** What one collection came to: how many traces, up to which minute; or why nothing. */
export type CollectTracesDTO =
  | { appId: string, outcome: 'collected', traces: number, until: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }
  | { appId: string, outcome: 'failed', message: string }

/**
 * What a client asks of an application's traces: in a window, of a use case (of a
 * context), of a queue or of one job; those that failed, ended in an error, ran again,
 * were kept because something asked (`keepTrace`, a signed header), logged a warning or
 * an error, the slowest, or those that took about `nearMs` (a percentile's examples). Newest
 * first, a page at a time (`before`), unless sorted by time taken.
 */
export const TraceListQuerySchema = z.object({
  window: z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h'),
  context: z.string().min(1).optional(),
  useCase: z.string().min(1).optional(),
  queue: z.string().min(1).optional(),
  job: z.string().min(1).optional(),
  /** Those that told an event, by its name: of its context. */
  told: z.string().min(1).optional(),
  show: z.enum(['all', 'failures', 'errors', 'retried', 'forced', 'logged', 'slow']).default('all'),
  nearMs: z.coerce.number().min(0).optional(),
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine(query => (query.useCase === undefined && query.told === undefined) || query.context !== undefined, { message: 'A use case or an event is asked of its context', path: ['context'] })

/** As a client asks it: numbers as numbers (the query string makes them text, which the schema reads back). */
export type TraceListQueryDTO = Omit<z.input<typeof TraceListQuerySchema>, 'nearMs' | 'limit'> & { nearMs?: number, limit?: number }

/** A trace in a list: what it was, how long, how it ended; and, of a use case's, how long its call took. */
export type TraceSummaryDTO = {
  id: string
  kind: 'http' | 'job'
  name: string
  startedAt: string
  ms: number
  outcome: Outcome | null
  retried: boolean
  /** Why it was kept whatever its share, when something asked. */
  forced: string | null
  actor: string | null
  useCases: string[]
  /** A job's run: of which queue, which run, for which event (by id: the one its teller told). */
  job: { queue: string, run: number, event: string, eventId: string } | null
  /** The use case asked for's call in it: the longest, if it called it more than once. */
  callMs: number | null
}

export type TraceListDTO = {
  traces: TraceSummaryDTO[]
  /** What to ask as `before` for the next page: null when there is none, or when sorted by time. */
  next: string | null
}

/**
 * A trace whole, and what it is linked to: the trace that told the event its job ran
 * for, the traces of the jobs its events caused, and every run of its job, if kept.
 */
export type TraceDTO = Trace & {
  causedBy: TraceSummaryDTO | null
  caused: TraceSummaryDTO[]
  runs: TraceSummaryDTO[]
}

/** How long the header that keeps a request's trace is good for: an hour unless asked, a day at most. */
export const TraceHeaderSchema = z.object({
  hours: z.coerce.number().int().min(1).max(24).default(1),
})

/** The header that keeps the trace of every request carrying it, until it ends: its name and value. */
export type TraceHeaderDTO = { name: string, value: string, expiresAt: string }
