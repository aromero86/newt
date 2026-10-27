import type { QueueMetrics_Deps } from './queue-metrics.deps'
import type { QueueMetrics_Module } from './queue-metrics.module'

/** When queue flows are collected and kept: every minute, every night; and forgotten: their application deleted. */
export function registerQueueMetricsWorkers(queueMetrics: QueueMetrics_Module, deps: QueueMetrics_Deps): void {
  queueMetrics.minutely.subscribe(() => queueMetrics.collectAll(), {
    strategy: 'handler',
    queue: 'queueMetrics.collectAll.on.queueMetrics.minutely',
  })
  queueMetrics.nightly.subscribe(() => queueMetrics.keepAll(), {
    strategy: 'handler',
    queue: 'queueMetrics.keepAll.on.queueMetrics.nightly',
  })
  deps.app.events.deleted.subscribe(app => queueMetrics.forget(app.id), {
    strategy: 'handler',
    queue: 'queueMetrics.forget.on.app.deleted',
  })
}
