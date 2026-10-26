import { FileStore } from 'newt/adapter-files'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'

/**
 * The SaaS: each workspace's boards, their columns and cards. Its people belong to
 * workspaces that `auth` keeps: `boards` asks it through ports it is handed when it opens.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
    const store = await FileStore.open({ folder: config.folder })
    const base = new BoardsBase({ name: 'boards', store })
    const modules = initializeModules(base, config, deps)
    return new Boards_Context(base, modules, config)
  }
}
