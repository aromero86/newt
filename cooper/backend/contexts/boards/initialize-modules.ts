import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'

/** Every module of `boards`, each one after the modules it uses: none yet. */
export function initializeModules(base: BoardsBase, config: Boards_Config) {
  return {}
}

export type Boards_Modules = ReturnType<typeof initializeModules>
