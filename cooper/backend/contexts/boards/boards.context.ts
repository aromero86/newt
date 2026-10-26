import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { CooperBase } from '../../shared/cooper-base'
import { ServedContext } from '../../shared/served-context'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'

/**
 * The SaaS: each workspace's boards, their columns and cards, on the web and through
 * MCP. Its people sign in through `auth`, which also keeps the workspaces and who
 * belongs to each.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: CooperBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  /** Opened after `auth`, which it uses. */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new CooperBase({ name: 'boards', store })
    return new Boards_Context(base, initializeModules(base, deps), config)
  }
}
