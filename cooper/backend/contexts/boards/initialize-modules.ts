import type { CooperBase } from '../../shared/cooper-base'
import type { Mailer } from '../../shared/mail/mailer'
import type { Auth_Context } from '../auth/auth.context'

/** What `boards`' modules are given besides its base: the context it uses, and a mailer. */
export type Boards_ModuleDeps = {
  auth: Auth_Context
  mailer: Mailer
}

/** Every module of `boards`, each one after the modules it uses. It has none yet. */
export function initializeModules(_base: CooperBase, _deps: Boards_ModuleDeps) {
  return {}
}

export type Boards_Modules = ReturnType<typeof initializeModules>
