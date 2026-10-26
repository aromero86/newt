import type { Analytics, AnalyticsRow } from '../../port-analytics'

/** Analytics kept in memory: for tests, and as the plainest example of an adapter. */
export class MemoryAnalytics implements Analytics {

  private readonly datasets = new Map<string, Map<string, AnalyticsRow>>()

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    const kept = this.datasets.get(dataset) ?? new Map<string, AnalyticsRow>()
    for (const row of rows) if (!kept.has(row.id)) kept.set(row.id, structuredClone(row))
    this.datasets.set(dataset, kept)
  }

  /** A dataset's rows, in the order they came. */
  async rows(dataset: string): Promise<AnalyticsRow[]> {
    return [...(this.datasets.get(dataset)?.values() ?? [])]
  }

  async close(): Promise<void> {}
}
