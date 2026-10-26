import type { CooperBase } from '../../shared/cooper-base'
import type { Auth_Context } from '../auth/auth.context'
import type { Boards_Context } from '../boards/boards.context'

/** What `backoffice`'s modules are given besides its base: the contexts it reads. */
export type Backoffice_ModuleDeps = {
  auth: Auth_Context
  boards: Boards_Context
}

/** Every module of `backoffice`, each one after the modules it uses. It has none yet. */
export function initializeModules(_base: CooperBase, _deps: Backoffice_ModuleDeps) {
  return {}
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
