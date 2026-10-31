import type { EventMetrics_Deps } from './event-metrics.deps'
import type { EventMetrics_Module } from './event-metrics.module'

/**
 * When event counts are collected and kept: every minute, every night; and when they are
 * forgotten: their application deleted.
 */
export function registerEventMetricsWorkers(eventMetrics: EventMetrics_Module, deps: EventMetrics_Deps): void {
  eventMetrics.minutely.subscribe(() => eventMetrics.collectAll(), {
    strategy: 'handler',
    queue: 'eventMetrics.collectAll.on.eventMetrics.minutely',
  })
  eventMetrics.nightly.subscribe(() => eventMetrics.keepAll(), {
    strategy: 'handler',
    queue: 'eventMetrics.keepAll.on.eventMetrics.nightly',
  })
  deps.app.events.deleted.subscribe(app => eventMetrics.forget(app.id), {
    strategy: 'handler',
    queue: 'eventMetrics.forget.on.app.deleted',
  })
}
