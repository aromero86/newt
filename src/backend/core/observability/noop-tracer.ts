import { Span } from "./span";
import { Tracer } from "./tracer";

export class NoopTracer implements Tracer {
  startActiveSpan<T>(_name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    return fn({ setError() {}, end() {} })
  }
}