import { BoundedContext } from '@newt-kit/newt/runtime'
import type { ContentSecurityPolicy, ServeOptions } from '@newt-kit/newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
  /** The built frontend it hands out for every address its routes do not take. */
  frontendFolder: string
  /** Where people open it: over HTTPS, browsers are told to come back only so (HSTS). */
  publicUrl: string
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up, and, on an HTTPS address, tells
 * browsers to come back only over HTTPS.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** What its server answers besides its modules' API: OAuth's endpoints, an MCP entry. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** What its pages may reach besides newt's policy: where its files are, for one. */
  protected csp(): ContentSecurityPolicy | undefined {
    return undefined
  }

  /** How it is served (`runContexts`, `serve`): its modules' API, what it adds, its health, and its frontend for any other address. */
  serving(): ServeOptions {
    const hsts = new URL(this.served.publicUrl).protocol === 'https:'
    return { port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder, csp: this.csp(), health: true, hsts }
  }
}
