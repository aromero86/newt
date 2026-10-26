import type { Span } from './span'
import type { Tracer } from './tracer'

const NO_SPAN: Span = { setError() {}, addEvent() {}, end() {} }

/**
 * A tracer that hands `tracer` only the spans whose name `keep` says: the rest run
 * without one, and what they start is a child of the span around them. To leave out
 * the worker's own (`name => !name.startsWith('job.')`).
 */
export function filterSpans(tracer: Tracer, keep: (name: string) => boolean): Tracer {
  return {
    startActiveSpan: (name, attributes, fn) => keep(name) ? tracer.startActiveSpan(name, attributes, fn) : fn(NO_SPAN),
    flush: async () => tracer.flush?.(),
  }
}
