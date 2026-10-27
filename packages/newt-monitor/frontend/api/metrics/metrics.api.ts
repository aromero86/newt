import type { EventTotalDTO, MetricsRetentionChangeDTO, MetricsRetentionDTO, MetricsWindow, SeriesDTO, SeriesQueryDTO, TopDTO, TopQueryDTO } from '../../../src/contexts/monitor/modules/metrics/metrics.schema'
import { Requester } from 'newt-react'

/** The monitor's `metrics` module: how many times each event of an application was told. */
export class MetricsApi extends Requester {
  protected readonly path = '/apps'

  /** Each event's total in a window, beside the window before it. */
  totals(appId: string, window: MetricsWindow) {
    return this.get<EventTotalDTO[]>(`/${appId}/metrics/events`, { window })
  }

  series(appId: string, query: SeriesQueryDTO) {
    return this.get<SeriesDTO>(`/${appId}/metrics/series`, query)
  }

  /** Who told it most: `by` is `actor` or `scope:<name>`. */
  top(appId: string, query: TopQueryDTO) {
    return this.get<TopDTO[]>(`/${appId}/metrics/top`, query)
  }

  /** The scopes it was told in, by name. */
  scopes(appId: string, query: { context: string, event: string, window: MetricsWindow }) {
    return this.get<string[]>(`/${appId}/metrics/scopes`, query)
  }

  retention(appId: string) {
    return this.get<MetricsRetentionDTO>(`/${appId}/metrics/retention`)
  }

  changeRetention(appId: string, input: MetricsRetentionChangeDTO) {
    return this.patch<MetricsRetentionDTO>(`/${appId}/metrics/retention`, input)
  }
}

/** Where an application's counts come live, as server-sent events (`EventSource`). */
export function liveMetricsUrl(appId: string): string {
  return `${Requester.baseUrl}/apps/${appId}/metrics/live`
}
