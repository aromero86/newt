import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { ServedContext } from '../../shared/served-context'
import { AuthBase } from './auth-base'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_Modules } from './initialize-modules'

/**
 * Who someone is: accounts, and who is signed in, for every app of cooper. It uses no
 * other context.
 */
export class Auth_Context extends ServedContext {

  private constructor(auth: AuthBase, readonly modules: Auth_Modules, readonly config: Auth_Config) {
    super('auth', auth, config)
  }

  /** Opening it brings its database up to date before any module reads it. */
  static async open(config: Auth_Config): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new AuthBase({ name: 'auth', store })
    const modules = initializeModules(base, config)
    return new Auth_Context(base, modules, config)
  }
}
