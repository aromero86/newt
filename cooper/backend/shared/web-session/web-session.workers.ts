import type { WebSession_Module } from './web-session.module'

/** Every night, the sessions past their days go: nobody signs in with them again, and their rows would only pile up. */
export function registerWebSessionWorkers(sessions: WebSession_Module): void {
  sessions.nightly.subscribe(() => sessions.purgeExpired(), {
    strategy: 'handler',
    queue: 'session.purgeExpired.on.session.nightly',
  })
}
