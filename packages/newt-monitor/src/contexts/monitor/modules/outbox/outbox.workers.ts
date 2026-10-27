import type { Outbox_Deps } from './outbox.deps'
import type { Outbox_Module } from './outbox.module'

/** When snapshots are taken and kept: every minute, every night; and forgotten: their application deleted. */
export function registerOutboxWorkers(outbox: Outbox_Module, deps: Outbox_Deps): void {
  outbox.minutely.subscribe(() => outbox.snapshotAll(), {
    strategy: 'handler',
    queue: 'outbox.snapshotAll.on.outbox.minutely',
  })
  outbox.nightly.subscribe(() => outbox.keepAll(), {
    strategy: 'handler',
    queue: 'outbox.keepAll.on.outbox.nightly',
  })
  deps.app.events.deleted.subscribe(app => outbox.forget(app.id), {
    strategy: 'handler',
    queue: 'outbox.forget.on.app.deleted',
  })
}
