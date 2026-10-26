import { BoundedContext } from 'newt/runtime'
import type { ServeOptions } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain. It answers `GET /api/health` without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** How it is served (`serve`): its modules' API and its health. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, health: true }
  }
}
