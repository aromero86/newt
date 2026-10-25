import type { AnalyticsRow } from './analytics-row'

/**
 * Where analytical data goes: a database made for reading a lot at once (ClickHouse,
 * DuckDB), not for saving entities. It is only ever added to: a row, once in, never
 * changes or goes; what changes later is a new row telling it.
 *
 * It has no transactions, so it is never a context's store: it is fed by `handler`
 * workers, after the events of what the store saved. A worker may run twice, so a row
 * carries an id of its own (the event's, the order line's): one already in is not
 * added again.
 *
 * Reading is each adapter's own: analytical queries are its database's language.
 */
export interface Analytics {
  /** Adds rows to a dataset; a row whose id is already there is left out. */
  append(dataset: string, rows: AnalyticsRow[]): Promise<void>
  close(): Promise<void>
}
