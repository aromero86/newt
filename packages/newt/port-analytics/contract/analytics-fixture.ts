import type { Analytics, AnalyticsRow } from '../../port-analytics'

/** How the analytics suite gets fresh, empty analytics of an adapter, and reads a dataset back. */
export type AnalyticsFixture<A extends Analytics = Analytics> = {
  open(): Promise<A>
  rows(analytics: A, dataset: string): Promise<AnalyticsRow[]>
}
