import type { Tracer } from '../core'

export type RunContextsOptions = {
  /** Who watches the whole application, every context and every request: none unless told. */
  tracer?: Tracer
  /** Stops them on SIGINT and SIGTERM, then ends the process: on unless told. */
  signals?: boolean
}
