import { NoopTracer } from './noop-tracer'
import type { Tracer } from './tracer'

/**
 * The tracer of the whole application, for the whole process: the one every context's
 * invocations and every router's requests start their spans on, so a request, and
 * the use cases it calls in any context, is one trace. None until `setTracer`.
 */
export const applicationTracer: { value: Tracer } = { value: new NoopTracer() }
