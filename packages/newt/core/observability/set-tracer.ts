import { applicationTracer } from './application-tracer'
import type { Tracer } from './tracer'

/**
 * Who watches the whole application: every context's use cases and every router's
 * requests, as one tracer, so a request that crosses contexts is one trace. Set once,
 * where the application starts (`runContexts` does it); a context's own `tracer`
 * (`BaseOptions`) goes before it.
 */
export function setTracer(tracer: Tracer): void {
  applicationTracer.value = tracer
}
