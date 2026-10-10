import type { AuthSession_Deps } from './auth-session.deps'
import type { AuthSession_Module } from './auth-session.module'

export function registerAuthSessionWorkers(sessions: AuthSession_Module, deps: AuthSession_Deps) {
  // A new password signs the account out everywhere but where it was changed
  // (everywhere, when it was reset from an email link).
  deps.authCredential.changed.subscribe(({ userId, sessionId }) => sessions.closeOthers(userId, sessionId))
}
