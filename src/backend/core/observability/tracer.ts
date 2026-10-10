import { Span } from "./span"

export interface Tracer {
  startActiveSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>
}
