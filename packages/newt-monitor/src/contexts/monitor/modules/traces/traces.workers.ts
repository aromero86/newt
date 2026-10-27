import type { Traces_Deps } from './traces.deps'
import type { Traces_Module } from './traces.module'

/** When traces are collected and kept: every minute, every night; and forgotten: their application deleted. */
export function registerTracesWorkers(traces: Traces_Module, deps: Traces_Deps): void {
  traces.minutely.subscribe(() => traces.collectAll(), {
    strategy: 'handler',
    queue: 'traces.collectAll.on.traces.minutely',
  })
  traces.nightly.subscribe(() => traces.keepAll(), {
    strategy: 'handler',
    queue: 'traces.keepAll.on.traces.nightly',
  })
  deps.app.events.deleted.subscribe(app => traces.forget(app.id), {
    strategy: 'handler',
    queue: 'traces.forget.on.app.deleted',
  })
}
