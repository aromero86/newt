import type { SqliteStore } from 'newt/adapter-sqlite'
import type { Analytics, AnalyticsRow } from 'newt/port-analytics'
import type { AnalyticsCount, AnalyticsCounts } from './analytics-counts'

/** A field of a row, as a query names it: letters, digits and `_`, never a piece of SQL. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * newt's analytics port on SQLite, for an application whose numbers are small enough
 * for its own database: newt brings no adapter yet (ClickHouse and DuckDB will come).
 * Every dataset is in one table, `analytics_row`, each row whole as JSON, in the
 * database of the context that reads it: it copies `migrations/00001_analytics_up.sql`
 * into its own.
 *
 * It keeps the port's promises (`describeAnalyticsContract`): rows are only added, and
 * one whose id is in already is left out, so the worker that appends may run twice.
 * Each append is a transaction of its own, as a mailer's send is a call of its own: it
 * is fed by `handler` workers, never inside the save of an entity.
 */
export class SqliteAnalytics implements Analytics, AnalyticsCounts {

  constructor(private readonly store: SqliteStore) {}

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.store.transaction(() => {
      const insert = this.store.connection.query('INSERT OR IGNORE INTO analytics_row (dataset, id, data) VALUES (?, ?, ?)')
      for (const row of rows) insert.run(dataset, row.id, JSON.stringify(row))
    })
  }

  /** A dataset's rows, in the order they came. */
  async rows(dataset: string): Promise<AnalyticsRow[]> {
    const found = this.store.connection.query('SELECT data FROM analytics_row WHERE dataset = ? ORDER BY rowid').all(dataset) as { data: string }[]
    return found.map(row => JSON.parse(row.data) as AnalyticsRow)
  }

  async count(dataset: string): Promise<number> {
    const found = this.store.connection.query('SELECT COUNT(*) AS count FROM analytics_row WHERE dataset = ?').get(dataset) as { count: number }
    return found.count
  }

  async countBy(dataset: string, field: string, options: { from?: string } = {}): Promise<AnalyticsCount[]> {
    if (!FIELD.test(field)) throw new Error(`'${field}' is not a field a row may have`)
    // SQLite only: `json_extract` reads a field of the JSON; DuckDB or ClickHouse would read a column.
    const found = this.store.connection.query(`
      SELECT json_extract(data, ?) AS value, COUNT(*) AS count
      FROM analytics_row
      WHERE dataset = ? AND json_extract(data, ?) >= ?
      GROUP BY value
      ORDER BY value
    `).all(`$.${field}`, dataset, `$.${field}`, options.from ?? '') as { value: unknown, count: number }[]
    return found.map(row => ({ value: String(row.value), count: row.count }))
  }

  /** The store is the context's, which closes it: there is nothing of its own to close. */
  async close(): Promise<void> {}
}
