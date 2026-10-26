/** How many rows of a dataset have one value of a field. */
export type AnalyticsCount = { value: string, count: number }

/**
 * The questions cooper asks its analytics. newt's port only appends: reading is each
 * adapter's own, in its database's language. A module that reads them takes this, so
 * it does not know which adapter answers.
 */
export interface AnalyticsCounts {
  /** How many rows a dataset has. */
  count(dataset: string): Promise<number>
  /**
   * How many rows of a dataset have each value of a field, in the order of the values,
   * from one on (`from`, compared as text: a day such as `2026-10-01`, a month).
   */
  countBy(dataset: string, field: string, options?: { from?: string }): Promise<AnalyticsCount[]>
}
