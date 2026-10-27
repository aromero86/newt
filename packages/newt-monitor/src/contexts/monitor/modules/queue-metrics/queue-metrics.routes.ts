import type { MonitorBase } from '../../../../monitor-base'
import type { QueueMetrics_Module } from './queue-metrics.module'

export function registerQueueMetricsRoutes(base: MonitorBase, queueMetrics: QueueMetrics_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?window=24h`: each queue's flow, beside the window before.
  base.http.get('/apps/:id/metrics/queues', async request => Response.json(await queueMetrics.totals(request.params.id, query(request))))

  // `?context=boards&queue=card.indexCard.on.card.created&window=24h&bucket=1h&compare=week`
  base.http.get('/apps/:id/metrics/queues/series', async request => Response.json(await queueMetrics.series(request.params.id, query(request))))
}
