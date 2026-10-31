import type { Tracer } from '../core'

export type RunContextsOptions = {
  /** Who watches the whole application, every context and every request: none unless told. */
  tracer?: Tracer
  /** Stops them on SIGINT and SIGTERM, then ends the process: on unless told. */
  signals?: boolean
  /**
   * How long, after its drain, each server waits for the requests in progress before it
   * closes them, so a stream that never ends cannot hold the stop: 10 seconds unless told.
   */
  stopTimeoutMs?: number
}
