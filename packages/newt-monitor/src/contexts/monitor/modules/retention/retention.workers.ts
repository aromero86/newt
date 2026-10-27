import type { Retention_Deps } from './retention.deps'
import type { Retention_Module } from './retention.module'

/** When it is forgotten: its application deleted. */
export function registerRetentionWorkers(retention: Retention_Module, deps: Retention_Deps): void {
  deps.app.events.deleted.subscribe(app => retention.forget(app.id), {
    strategy: 'handler',
    queue: 'retention.forget.on.app.deleted',
  })
}
