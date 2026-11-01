import type { MetricsWindow } from '../../../backend/contexts/monitor/modules/event-metrics/event-metrics.schema'
import type { UseCaseSeriesDTO, UseCaseSeriesQueryDTO, UseCaseTopDTO, UseCaseTopQueryDTO, UseCaseTotalDTO } from '../../../backend/contexts/monitor/modules/use-case-metrics/use-case-metrics.schema'
import { Requester } from 'newt-kit-react'

/** The monitor's `useCaseMetrics` module: how each use case of an application went. */
export class UseCaseMetricsApi extends Requester {
  protected readonly path = '/apps'

  /** Each use case's calls, mean and percentiles in a window, beside the window before. */
  totals(appId: string, window: MetricsWindow) {
    return this.get<UseCaseTotalDTO[]>(`/${appId}/metrics/use-cases`, { window })
  }

  series(appId: string, query: UseCaseSeriesQueryDTO) {
    return this.get<UseCaseSeriesDTO>(`/${appId}/metrics/use-cases/series`, query)
  }

  /** The scopes it was called in, by name. */
  scopes(appId: string, query: { context: string, useCase: string, window: MetricsWindow }) {
    return this.get<string[]>(`/${appId}/metrics/use-cases/scopes`, query)
  }

  /** Who called it most: `by` is `actor` or `scope:<name>`. */
  top(appId: string, query: UseCaseTopQueryDTO) {
    return this.get<UseCaseTopDTO[]>(`/${appId}/metrics/use-cases/top`, query)
  }
}
