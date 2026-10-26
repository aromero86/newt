import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { CooperBase } from '../../shared/cooper-base'
import { ServedContext } from '../../shared/served-context'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_ModuleDeps, type Auth_Modules } from './initialize-modules'

/**
 * Who someone is: accounts, workspaces (tenants), who may enter which app, and the
 * OAuth server every app of cooper, and any MCP client, signs people in with. It uses
 * no other context.
 */
export class Auth_Context extends ServedContext {

  private constructor(base: CooperBase, readonly modules: Auth_Modules, readonly config: Auth_Config) {
    super('auth', base, config)
  }

  /** Opening it brings its database up to date before any module reads it. */
  static async open(config: Auth_Config, deps: Auth_ModuleDeps): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new CooperBase({ name: 'auth', store })
    return new Auth_Context(base, initializeModules(base, deps), config)
  }
}
