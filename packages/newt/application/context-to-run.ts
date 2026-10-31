import type { ServeOptions } from '../http'
import type { BoundedContext } from '../runtime'

/** A context of an application, and how it is served, if it is. */
export type ContextToRun = {
  context: Pick<BoundedContext, 'name' | 'start' | 'stopWorker' | 'close'>
  /** Its server: its router, the routes beside it, its frontend, its health. None when absent. */
  serve?: ServeOptions
}
