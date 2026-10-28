import { AsyncLocalStorage } from 'node:async_hooks'
import { findCurrentActor } from '../context/find-current-actor'
import { outcomeOf, type Outcome } from '../metrics/outcome'
import { activeScopes } from '../scope/registered-scopes'
import type { LogFields, LogLevel } from '../logs/log-line'
import type { SpanAttributeValue, SpanKind, Trace, TraceJob, TraceLog, TraceSpan, TracedEvent } from './trace'
import { keeps } from './trace-sampling'
import { applicationTraces } from './trace-sink'

/** The most spans a trace keeps: a loop of queries past it is counted, not kept. */
const MAX_SPANS = 500
const MESSAGE_CHARS = 1_000
const STACK_LINES = 12

/** A trace on its way: its spans so far, and what it learns as they run. */
class OpenTrace {
  readonly id = Bun.randomUUIDv7()
  readonly started = performance.now()
  readonly startedAt = new Date().toISOString()
  readonly spans: TraceSpan[] = []
  readonly told: TracedEvent[] = []
  readonly logs: TraceLog[] = []
  dropped = 0
  droppedLogs = 0
  forced: string | null = null
  actor: string | null = null
  scopes: Record<string, string> = {}
  private next = 0

  constructor(readonly kind: 'http' | 'job', readonly name: string, readonly job: TraceJob | null) {}

  /** A new span inside `parentId`, or null past the most a trace keeps. */
  open(parentId: string | null, kind: SpanKind, name: string, context: string | null, attributes: Record<string, SpanAttributeValue>): TraceSpan | null {
    if (this.spans.length >= MAX_SPANS) {
      this.dropped++
      return null
    }
    const span: TraceSpan = { id: (++this.next).toString(36), parentId, kind, name, context, startMs: performance.now() - this.started, ms: 0, outcome: null, attributes, failure: null }
    this.spans.push(span)
    return span
  }
}

/** The errors a span already described: the ones around it, which it went through, say only how they ended. */
const described = new WeakSet<object>()

/** The span running now, and its trace. */
const active = new AsyncLocalStorage<{ trace: OpenTrace, span: TraceSpan }>()

/** Whether a trace is being recorded here: what a step that costs to describe asks first. */
export function isTracing(): boolean {
  return active.getStore() !== undefined
}

/** What a trace starts from: a request or a job, and why it is kept whatever its share, when something asked already (a signed header). */
type TraceRoot = { kind: 'http' | 'job', name: string, job?: TraceJob, forced?: string | null }

/**
 * Keeps the trace in progress whatever its share, and says why: a request worth seeing
 * whole (a payment, a customer being helped). The jobs its events cause are kept with
 * it. Outside a trace, or with traces off, it does nothing. The first reason stays.
 *
 * ```ts
 * if (order.total > 10_000) keepTrace('a large order')
 * ```
 */
export function keepTrace(reason = 'kept by the code'): void {
  const current = active.getStore()
  if (current) current.trace.forced ??= reason
}

/**
 * Runs a request or a job as the root of a trace, when the application records them
 * (`serveMonitor` turns it on). `outcomeOf` says how a request that answered ended: a
 * router answers an error instead of throwing it.
 */
export function traceRoot<T>(root: TraceRoot, fn: () => T | Promise<T>, outcomeOfResult?: (result: T) => Outcome | null): T | Promise<T> {
  // Off, it is the call as it was: not even a turn of the event loop more.
  if (!applicationTraces.enabled || !applicationTraces.sink) return fn()
  return recordRoot(root, fn, outcomeOfResult)
}

async function recordRoot<T>(root: TraceRoot, fn: () => T | Promise<T>, outcomeOfResult?: (result: T) => Outcome | null): Promise<T> {
  const trace = new OpenTrace(root.kind, root.name, root.job ?? null)
  trace.forced = root.forced ?? null
  const span = trace.open(null, root.kind, root.name, null, {})!
  try {
    const result = await active.run({ trace, span }, fn)
    span.outcome = outcomeOfResult?.(result) ?? null
    return result
  } catch (error) {
    ended(span, error)
    throw error
  } finally {
    span.ms = performance.now() - trace.started
    finish(trace)
  }
}

/**
 * Runs `fn` as a span of the trace in progress, inside the one running now; just runs
 * it outside any. `after` adds what is known once it ends: the rows a query read.
 */
export function traceSpan<T>(step: { kind: SpanKind, name: string, context?: string | null, attributes?: Record<string, SpanAttributeValue> }, fn: () => Promise<T>, after?: (result: T) => Record<string, SpanAttributeValue>): Promise<T> {
  const parent = active.getStore()
  return parent ? recordSpan(parent, step, fn, after) : fn()
}

async function recordSpan<T>(parent: { trace: OpenTrace, span: TraceSpan }, step: { kind: SpanKind, name: string, context?: string | null, attributes?: Record<string, SpanAttributeValue> }, fn: () => Promise<T>, after?: (result: T) => Record<string, SpanAttributeValue>): Promise<T> {
  const { trace } = parent
  const span = trace.open(parent.span.id, step.kind, step.name, step.context ?? null, step.attributes ?? {})
  if (!span) return fn()
  if (step.kind === 'use-case' && trace.actor === null) {
    trace.actor = findCurrentActor()?.userId ?? null
    trace.scopes = activeScopes()
  }
  try {
    const result = await active.run({ trace, span }, fn)
    if (after) Object.assign(span.attributes, after(result))
    return result
  } catch (error) {
    ended(span, error)
    throw error
  } finally {
    span.ms = performance.now() - trace.started - span.startMs
  }
}

/**
 * Notes an event told in the trace in progress, as an instant inside the step that told
 * it: the traces of the jobs it causes hang from it, found by its id.
 */
export function traceTold(event: { id: string, name: string }, context: string): void {
  const current = active.getStore()
  if (!current) return
  const { trace } = current
  trace.told.push({ id: event.id, name: event.name, context })
  const span = trace.open(current.span.id, 'event', event.name, context, { eventId: event.id })
  if (span) span.ms = 0
}

/**
 * Notes a log line in the trace in progress, at the step running, and says where it was
 * written; outside a trace, null. An error keeps the trace whatever its share. Past the
 * most a trace keeps, a line is counted, not kept.
 */
export function traceLog(level: LogLevel, message: string, fields: LogFields): { traceId: string, spanId: string, context: string | null } | null {
  const current = active.getStore()
  if (!current) return null
  const { trace, span } = current
  if (level === 'error') trace.forced ??= 'error log'
  if (trace.logs.length >= applicationTraces.maxLogs) trace.droppedLogs++
  else trace.logs.push({ spanId: span.id, atMs: performance.now() - trace.started, level, message, fields: plain(fields) })
  return { traceId: trace.id, spanId: span.id, context: contextOf(trace, span) }
}

/** The context of a step: its own, or the nearest one above it that has one. */
function contextOf(trace: OpenTrace, span: TraceSpan): string | null {
  for (let at: TraceSpan | undefined = span; at; at = trace.spans.find(each => each.id === at!.parentId)) if (at.context) return at.context
  return null
}

/** Fields as JSON keeps them, as they were when written: an error as its name, message and stack; what cannot be, as text. */
function plain(fields: LogFields): LogFields {
  try {
    return JSON.parse(JSON.stringify(fields, (_, value: unknown) => (
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack ?? null } : typeof value === 'bigint' ? value.toString() : value
    ))) as LogFields
  } catch (error) {
    return { unreadable: String(error) }
  }
}

/** How a span that threw ended: a failure keeps its message and stack; a validation, the fields it found wrong. */
function ended(span: TraceSpan, error: unknown): void {
  span.outcome = outcomeOf(error)
  if (typeof error === 'object' && error !== null) {
    if (described.has(error)) return
    described.add(error)
  }
  if (span.outcome.kind === 'failure') {
    span.failure = error instanceof Error
      ? { message: error.message.slice(0, MESSAGE_CHARS), stack: error.stack?.split('\n').slice(0, STACK_LINES).join('\n') ?? null }
      : { message: String(error).slice(0, MESSAGE_CHARS), stack: null }
  } else if (span.outcome.code === 'validation') {
    const issues = (error as { issues?: { path: PropertyKey[] }[] }).issues ?? []
    span.attributes['validation.fields'] = [...new Set(issues.map(issue => issue.path.map(String).join('.') || '(root)'))].join(', ')
  }
}

/**
 * Closes a trace: a call that ran once keeps no span for its one run, which says
 * nothing; one that ran more keeps each, and says how many. Then it is kept, or not.
 */
function finish(open: OpenTrace): void {
  const sink = applicationTraces.sink
  if (!sink) return
  const spans = collapsed(open.spans, open.logs)
  const root = spans[0]!
  const calls = spans.filter(span => span.kind === 'use-case')
  // A request answers its errors: it ended as its first call did, as bad as its status says.
  if (root.kind === 'http' && root.outcome) {
    const call = calls.find(each => each.parentId === root.id && each.outcome)
    if (call) root.outcome = { kind: root.outcome.kind, code: call.outcome!.code }
  }
  const trace: Trace = {
    id: open.id, kind: open.kind, name: open.name, startedAt: open.startedAt, ms: root.ms,
    outcome: root.outcome,
    retried: calls.some(call => Number(call.attributes.runs ?? 1) > 1) || (open.job?.run ?? 1) > 1,
    actor: open.actor, scopes: open.scopes,
    useCases: [...new Set(calls.map(call => call.name))],
    told: open.told, job: open.job, spans, dropped: open.dropped, forced: open.forced,
    logs: open.logs, droppedLogs: open.droppedLogs,
  }
  try {
    sink.finished(trace, keeps(trace, applicationTraces.sampleRate))
  } catch (error) {
    console.error('[traces] a trace could not be recorded:', error)
  }
}

/** The spans without the lone run of a call that ran once: its steps, its log lines, and what it said of how it ended, go to the call. */
function collapsed(spans: TraceSpan[], logs: TraceLog[]): TraceSpan[] {
  const runs = new Map<string, TraceSpan[]>()
  for (const span of spans) if (span.kind === 'attempt') runs.set(span.parentId!, [...runs.get(span.parentId!) ?? [], span])
  const lone = new Map<string, string>()
  for (const [id, attempts] of runs) {
    const call = spans.find(span => span.id === id)!
    if (attempts.length > 1) {
      call.attributes.runs = attempts.length
      continue
    }
    const [run] = attempts as [TraceSpan]
    lone.set(run.id, id)
    call.failure ??= run.failure
    call.attributes = { ...run.attributes, ...call.attributes }
  }
  for (const line of logs) if (lone.has(line.spanId)) line.spanId = lone.get(line.spanId)!
  return spans
    .filter(span => !lone.has(span.id))
    .map(span => (span.parentId && lone.has(span.parentId) ? { ...span, parentId: lone.get(span.parentId)! } : span))
}
