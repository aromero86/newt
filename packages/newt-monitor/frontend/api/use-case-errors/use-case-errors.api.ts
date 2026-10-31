import type { MetricsWindow } from '../../../backend/contexts/monitor/modules/event-metrics/event-metrics.schema'
import type { ErrorCodeDTO, ErrorCodesQueryDTO, ErrorsSeriesDTO, ErrorsSeriesQueryDTO, ErrorsTopDTO, ErrorsTopQueryDTO, ErrorsTotalDTO } from '../../../backend/contexts/monitor/modules/use-case-errors/use-case-errors.schema'
import { Requester } from 'newt-react'

/** The monitor's `useCaseErrors` module: how each use case's calls ended badly. */
export class UseCaseErrorsApi extends Requester {
  protected readonly path = '/apps'

  /** Each use case's errors and failures in a window, beside the window before. */
  totals(appId: string, window: MetricsWindow) {
    return this.get<ErrorsTotalDTO[]>(`/${appId}/metrics/errors`, { window })
  }

  series(appId: string, query: ErrorsSeriesQueryDTO) {
    return this.get<ErrorsSeriesDTO>(`/${appId}/metrics/errors/series`, query)
  }

  /** By code, beside the window before. */
  codes(appId: string, query: ErrorCodesQueryDTO) {
    return this.get<ErrorCodeDTO[]>(`/${appId}/metrics/errors/codes`, query)
  }

  /** Who ends its calls in errors, or failures, most. */
  top(appId: string, query: ErrorsTopQueryDTO) {
    return this.get<ErrorsTopDTO[]>(`/${appId}/metrics/errors/top`, query)
  }
}
