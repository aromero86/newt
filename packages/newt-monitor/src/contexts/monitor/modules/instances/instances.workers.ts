import type { Instances_Deps } from './instances.deps'
import type { Instances_Module } from './instances.module'

/** When instances are collected and kept: every minute, every night; and forgotten: their application deleted. */
export function registerInstancesWorkers(instances: Instances_Module, deps: Instances_Deps): void {
  instances.minutely.subscribe(() => instances.collectAll(), {
    strategy: 'handler',
    queue: 'instances.collectAll.on.instances.minutely',
  })
  instances.nightly.subscribe(() => instances.keepAll(), {
    strategy: 'handler',
    queue: 'instances.keepAll.on.instances.nightly',
  })
  deps.app.events.deleted.subscribe(app => instances.forget(app.id), {
    strategy: 'handler',
    queue: 'instances.forget.on.app.deleted',
  })
}
