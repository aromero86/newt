import type { CooperBase } from '../../shared/cooper-base'
import type { Mailer } from '../../shared/mail/mailer'

/** What `auth`'s modules are given besides its base. */
export type Auth_ModuleDeps = {
  mailer: Mailer
}

/** Every module of `auth`, each one after the modules it uses. It has none yet. */
export function initializeModules(_base: CooperBase, _deps: Auth_ModuleDeps) {
  return {}
}

export type Auth_Modules = ReturnType<typeof initializeModules>
