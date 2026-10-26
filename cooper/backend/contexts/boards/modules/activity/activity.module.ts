import { Module } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Options } from './activity-options'
import { registerActivityWorkers } from './activity.workers'

/**
 * What happened to each card, and who did it. For now, a line in the server's log
 * as each card moves, told by the card's own event.
 */
export class Activity_Module extends Module {

  static initialize(base: BoardsBase, deps: Activity_Deps, options: Activity_Options): Activity_Module {
    const module = new Activity_Module(base)
    registerActivityWorkers(module, deps, options)
    return module
  }

  private constructor(base: BoardsBase) {
    super('activity', base.invocations)
  }
}
