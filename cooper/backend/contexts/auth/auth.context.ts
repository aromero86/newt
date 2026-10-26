import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { ServedContext } from '../../shared/served-context'
import { AuthBase } from './auth-base'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_ModuleDeps, type Auth_Modules } from './initialize-modules'
import { oauthServerMetadataRoutes } from './oauth-server-metadata'

/**
 * Who someone is: accounts, workspaces (tenants), who may enter which app, and the
 * OAuth server every app of cooper, and any MCP client, signs people in with. It uses
 * no other context.
 */
export class Auth_Context extends ServedContext {

  private constructor(private readonly auth: AuthBase, readonly modules: Auth_Modules, readonly config: Auth_Config) {
    super('auth', auth, config)
  }

  /**
   * Opening it brings its database up to date before any module reads it, and the
   * OAuth clients of the products in step with cooper's code and configuration.
   */
  static async open(config: Auth_Config, deps: Auth_ModuleDeps): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new AuthBase({ name: 'auth', store })
    const modules = initializeModules(base, config, deps)
    await modules.oauthClient.declareProducts()
    return new Auth_Context(base, modules, config)
  }

  /** OAuth's own addresses, beside the API: its endpoints and the server's metadata. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...this.auth.oauth.routes(), ...oauthServerMetadataRoutes(this.config.publicUrl) }
  }
}
