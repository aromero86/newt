import type { LogFields, LogLevel } from '../logs/log-line'
import type { Outcome } from '../metrics/outcome'

/** What a span is: a request or a job (a trace's root), a use case's call, one of its runs, a read or write of a table, a transaction, an event told (an instant). */
export type SpanKind = 'http' | 'job' | 'use-case' | 'attempt' | 'query' | 'transaction' | 'event' | 'rate-limit' | 'storage'

/** What a span says of itself: a query's shape, the rows it read, the runs of a call. Never a value it was given. */
export type SpanAttributeValue = string | number | boolean

/**
 * One step of a trace: when it started (from the trace's start) and how long it took,
 * which step it is inside of, and how it ended. A failure keeps its message and its
 * stack; an error, only its code (it says it may happen): nothing of what it was given.
 */
export type TraceSpan = {
  id: string
  parentId: string | null
  kind: SpanKind
  /** `POST /api/cards`, `card.create`, `attempt 2`, `card.find`, `transaction`, `session.signIn` */
  name: string
  /** The context it ran in: null for a request, which may cross several. */
  context: string | null
  /** Since the trace started, in milliseconds. */
  startMs: number
  ms: number
  outcome: Outcome | null
  attributes: Record<string, SpanAttributeValue>
  /** A failure's message and stack, trimmed. */
  failure: { message: string, stack: string | null } | null
}

/** A log line written while a trace was recorded: at which step, when (from the trace's start), and what it said. */
export type TraceLog = {
  spanId: string
  atMs: number
  level: LogLevel
  message: string
  fields: LogFields
}

/** An event a trace told. */
export type TracedEvent = { id: string, name: string, context: string }

/** The job a trace ran: which run of it, of which queue, for which event. */
export type TraceJob = { id: string, queue: string, run: number, event: string, eventId: string }

/**
 * A request, or a job, and everything it did: its use cases, their runs, their
 * queries, as a tree of spans. Kept whole when anything went wrong or ran again, and
 * a share of the rest. The events it told are kept by id: the trace of a job they
 * caused finds this one by its own `job.eventId`.
 */
export type Trace = {
  id: string
  kind: 'http' | 'job'
  name: string
  startedAt: string
  ms: number
  /** The worst of its spans: a failure over an error. */
  outcome: Outcome | null
  /** Whether a call of it ran more than once after a conflict, or it is a job's run after the first. */
  retried: boolean
  actor: string | null
  scopes: Record<string, string>
  /** The use cases it called, each once: what it is searched by. */
  useCases: string[]
  /** The events it told: by id, which a job's trace has as its `job.eventId`, and by name, in the context that told it. */
  told: TracedEvent[]
  job: TraceJob | null
  spans: TraceSpan[]
  /** The spans left out past the most a trace keeps. */
  dropped: number
  /** Why it was kept whatever its share, when something asked: `keepTrace`'s reason, a signed header, an error logged. */
  forced: string | null
  /** The log lines written while it ran, up to the most a trace keeps (`setTraces`'s `maxLogs`). */
  logs: TraceLog[]
  /** The lines left out past that. */
  droppedLogs: number
}

/** The traces of the minutes closed since a cursor, and the cursor to ask from next time. */
export type ClosedTraces = {
  traces: Trace[]
  until: string
}
