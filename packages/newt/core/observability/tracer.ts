import type { Span } from './span'
import type { SpanAttributes } from './span-attributes'

/**
 * Who watches the invocations: an APM, OpenTelemetry, a log. A span started inside
 * another is its child: the tracer keeps track of which is active.
 */
export interface Tracer {
  startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T>
  /** Sends the spans it still keeps, for one that sends them in batches: once the application stops. */
  flush?(): Promise<void>
}
