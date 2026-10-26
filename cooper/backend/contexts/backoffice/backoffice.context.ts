import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { CooperBase } from '../../shared/cooper-base'
import { ServedContext } from '../../shared/served-context'
import type { Backoffice_Config } from './backoffice-config'
import { initializeModules, type Backoffice_ModuleDeps, type Backoffice_Modules } from './initialize-modules'

/**
 * The staff's console: it reads `auth` and `boards`, and changes them only through
 * their use cases. Only the staff (access to the `backoffice` app in `auth`) enter it.
 * Its own database keeps its web sessions and its analytics.
 */
export class Backoffice_Context extends ServedContext {

  private constructor(base: CooperBase, readonly modules: Backoffice_Modules, readonly config: Backoffice_Config) {
    super('backoffice', base, config)
  }

  /** Opened after `auth` and `boards`, which it uses. */
  static async open(config: Backoffice_Config, deps: Backoffice_ModuleDeps): Promise<Backoffice_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new CooperBase({ name: 'backoffice', store })
    return new Backoffice_Context(base, initializeModules(base, config, deps), config)
  }
}
