import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config) {
  const board = Board_Module.initialize(base)
  return { board }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
