import type { MetricsWindow } from '../../../backend/contexts/monitor/modules/event-metrics/event-metrics.schema'
import type { QueueSeriesDTO, QueueSeriesQueryDTO, QueueTotalDTO } from '../../../backend/contexts/monitor/modules/queue-metrics/queue-metrics.schema'
import { Requester } from 'newt-react'

/** The monitor's `queueMetrics` module: how each queue of an application flows. */
export class QueueMetricsApi extends Requester {
  protected readonly path = '/apps'

  /** Each queue's flow in a window, beside the window before. */
  totals(appId: string, window: MetricsWindow) {
    return this.get<QueueTotalDTO[]>(`/${appId}/metrics/queues`, { window })
  }

  series(appId: string, query: QueueSeriesQueryDTO) {
    return this.get<QueueSeriesDTO>(`/${appId}/metrics/queues/series`, query)
  }
}
