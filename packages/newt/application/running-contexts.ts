import type { Server } from 'bun'

/** An application's contexts, running. */
export type RunningContexts = {
  /** Each served context's server, by the context's name. */
  servers: Record<string, Server<undefined>>
  /** Stops them, once: every server first, then each context, the last one given first. */
  stop(): Promise<void>
}
