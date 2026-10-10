import type { Session_Deps } from './session.deps'
import type { Session_Module } from './session.module'

export function registerSessionWorkers(sessions: Session_Module, deps: Session_Deps) {
  // A new password signs the account out everywhere but where it was changed.
  deps.credential.changed.subscribe(({ userId, sessionId }) => sessions.closeOthers(userId, sessionId))
}
