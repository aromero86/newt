import type { SpanAttributes } from './span-attributes'

export interface Span {
  setError(error: unknown): void
  /** Something worth noting that happened during the span, with what describes it. */
  addEvent(name: string, attributes: SpanAttributes): void
  end(): void
}
