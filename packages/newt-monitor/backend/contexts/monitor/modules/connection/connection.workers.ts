import type { Connection_Deps } from './connection.deps'
import type { Connection_Module } from './connection.module'

/** An application deleted: whether it answered goes with it. */
export function registerConnectionWorkers(connection: Connection_Module, deps: Connection_Deps): void {
  deps.app.events.deleted.subscribe(app => connection.forget(app.id), {
    strategy: 'handler',
    queue: 'connection.forget.on.app.deleted',
  })
}
