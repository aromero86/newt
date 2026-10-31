import type { UseCaseMetrics_Deps } from './use-case-metrics.deps'
import type { UseCaseMetrics_Module } from './use-case-metrics.module'

/** When timings are collected and kept: every minute, every night; and forgotten: their application deleted. */
export function registerUseCaseMetricsWorkers(useCaseMetrics: UseCaseMetrics_Module, deps: UseCaseMetrics_Deps): void {
  useCaseMetrics.minutely.subscribe(() => useCaseMetrics.collectAll(), {
    strategy: 'handler',
    queue: 'useCaseMetrics.collectAll.on.useCaseMetrics.minutely',
  })
  useCaseMetrics.nightly.subscribe(() => useCaseMetrics.keepAll(), {
    strategy: 'handler',
    queue: 'useCaseMetrics.keepAll.on.useCaseMetrics.nightly',
  })
  deps.app.events.deleted.subscribe(app => useCaseMetrics.forget(app.id), {
    strategy: 'handler',
    queue: 'useCaseMetrics.forget.on.app.deleted',
  })
}
