import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span, SpanAttributes, Tracer } from 'newt/core'

/** A span as it is kept until its trace is written: what it was, how long, and what it called. */
type TracedSpan = {
  name: string
  attributes: SpanAttributes
  started: number
  ms: number
  error: string | null
  events: string[]
  children: TracedSpan[]
}

/** Where a line goes: the console, or a list in a test. */
export type TraceWriter = (line: string) => void

/**
 * A tracer that writes each trace to the console once it ends: the use case called
 * from outside, with the ones it called inside it, how long each took, a conflict
 * retried and an error that is not a domain one. It is newt's `Tracer`, the same an
 * OpenTelemetry adapter implements: an application hands one to the base of each
 * context it wants to watch.
 *
 * The worker's own spans (`job.claim` every few seconds, `job.close`…) are left out:
 * what a job does is a use case, and that one is written.
 */
export class ConsoleTracer implements Tracer {

  /** The span running now, which a span started inside it is a child of. */
  private readonly active = new AsyncLocalStorage<TracedSpan>()

  constructor(private readonly write: TraceWriter = line => console.log(line)) {}

  async startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    if (name.startsWith('job.')) return fn({ setError() {}, addEvent() {}, end() {} })

    const parent = this.active.getStore()
    const traced: TracedSpan = { name, attributes, started: performance.now(), ms: 0, error: null, events: [], children: [] }
    parent?.children.push(traced)
    const span: Span = {
      setError: error => { traced.error = error instanceof Error ? error.message : String(error) },
      addEvent: (event, eventAttributes) => { traced.events.push(`${event} ${JSON.stringify(eventAttributes)}`) },
      end: () => { traced.ms = performance.now() - traced.started },
    }
    try {
      return await this.active.run(traced, () => fn(span))
    } finally {
      if (traced.ms === 0) span.end()
      // A trace is written whole, once the span that began it ends.
      if (!parent) this.print(traced, 0)
    }
  }

  private print(traced: TracedSpan, depth: number): void {
    const where = traced.attributes.context ? `${traced.attributes.context} ` : ''
    const notes = [...traced.events, ...(traced.error ? [`error: ${traced.error}`] : [])]
    this.write(`[trace] ${'  '.repeat(depth)}${where}${traced.name} ${traced.ms.toFixed(1)} ms${notes.length ? ` (${notes.join('; ')})` : ''}`)
    for (const child of traced.children) this.print(child, depth + 1)
  }
}
