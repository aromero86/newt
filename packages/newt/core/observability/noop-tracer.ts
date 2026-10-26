import type { Span } from './span'
import type { SpanAttributes } from './span-attributes'
import type { Tracer } from './tracer'

export class NoopTracer implements Tracer {
  startActiveSpan<T>(_name: string, _attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    return fn({ setError() {}, addEvent() {}, end() {} })
  }
}
