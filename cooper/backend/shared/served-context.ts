import type { Server } from 'bun'
import { BoundedContext } from 'newt/runtime'
import { serve } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
  /** The built frontend it hands out for every address its routes do not take. */
  frontendFolder: string
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up (`serve`'s `health`).
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** What its server answers besides its modules' API: an MCP entry, a `/.well-known` document. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** Its server: its modules' API, what it adds, and its frontend for any other address. */
  serve(): Server<undefined> {
    return serve({ port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder, health: true })
  }
}
