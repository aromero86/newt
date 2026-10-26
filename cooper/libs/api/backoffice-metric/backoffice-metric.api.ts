import type { MetricsOverviewDTO } from '../../../backend/contexts/backoffice/modules/metric/metric.schema'
import { Requester } from '../core/requester'

/** The backoffice's `metric` module: cooper's numbers. */
export class BackofficeMetricApi extends Requester {
  protected readonly path = '/metrics'

  /** The totals, and each of the last days. */
  overview() {
    return this.get<MetricsOverviewDTO>('')
  }
}
