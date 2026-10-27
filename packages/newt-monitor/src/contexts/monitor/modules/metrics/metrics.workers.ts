import type { Metrics_Deps } from './metrics.deps'
import type { Metrics_Module } from './metrics.module'

/**
 * When metrics are collected and kept: every minute, every night; and when they are
 * forgotten: their application deleted.
 */
export function registerMetricsWorkers(metrics: Metrics_Module, deps: Metrics_Deps): void {
  metrics.minutely.subscribe(() => metrics.collectAll(), {
    strategy: 'handler',
    queue: 'metrics.collectAll.on.metrics.minutely',
  })
  metrics.nightly.subscribe(() => metrics.keepAll(), {
    strategy: 'handler',
    queue: 'metrics.keepAll.on.metrics.nightly',
  })
  deps.app.events.deleted.subscribe(app => metrics.forget(app.id), {
    strategy: 'handler',
    queue: 'metrics.forget.on.app.deleted',
  })
}
