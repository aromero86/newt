import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import { ServedContext } from '../../shared/served-context'
import { AuthBase } from './auth-base'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_ModuleDeps, type Auth_Modules } from './initialize-modules'
import { registerOauthServerMetadata } from './oauth-server-metadata'

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
   * OAuth clients of the products in step with cooper's code and configuration. The
   * real time tells its sessions, tokens and invitations when they expire, unless a
   * test gives it a `clock` of its own.
   */
  static async open(config: Auth_Config, deps: Auth_ModuleDeps, clock?: Clock): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new AuthBase({ name: 'auth', store, clock })
    const modules = initializeModules(base, config, deps)
    registerOauthServerMetadata(base.oauth, config.publicUrl)
    await modules.oauthClient.declareProducts()
    return new Auth_Context(base, modules, config)
  }

  /**
   * OAuth's own addresses, beside the API: its endpoints and the server's metadata.
   * What an MCP client calls itself (the metadata, registering, the token endpoint) is
   * open to pages of any origin (`cors`): some clients, such as the MCP inspector, run
   * in a browser. The authorization endpoint is not: the browser goes to it.
   */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...this.auth.oauth.routes() }
  }
}
