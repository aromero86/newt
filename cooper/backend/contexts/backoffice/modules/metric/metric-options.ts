import type { Analytics } from 'newt-kit/port-analytics'
import type { AnalyticsCounts } from '../../../../shared/analytics/analytics-counts'

/** What the context configures the metrics with. */
export type Metric_Options = {
  /** Where they are kept: appended to by the workers, read by the overview. */
  analytics: Analytics & AnalyticsCounts
  /** How many days the overview goes back, today included. */
  days: number
}
