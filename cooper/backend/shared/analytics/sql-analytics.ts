import { sql, type RawBuilder } from 'kysely'
import { SqliteStore } from 'newt-kit/adapter-sqlite'
import type { PostgresStore } from 'newt-kit/adapter-postgres'
import { kyselyFor } from 'newt-kit/kysely'
import type { Analytics, AnalyticsRow } from 'newt-kit/port-analytics'
import type { AnalyticsCount, AnalyticsCounts } from './analytics-counts'

/** A field of a row, as a query names it: letters, digits and `_`, never a piece of SQL. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Its one table, as Kysely queries it: each row whole, as JSON text. */
type AnalyticsDatabase = {
  analytics_row: { dataset: string, id: string, data: string }
}

/**
 * newt's analytics port on the context's own SQL database, SQLite or Postgres, for an
 * application whose numbers are small enough for it: newt brings no adapter yet
 * (ClickHouse and DuckDB will come). Every dataset is in one table, `analytics_row`,
 * each row whole as JSON, in the database of the context that reads it: it copies
 * `migrations/<sqlite|postgres>/00001_analytics_up.sql` into its own. Its queries are
 * Kysely's, the same on both, but for reading a field of the JSON.
 *
 * It keeps the port's promises (`describeAnalyticsContract`): rows are only added, and
 * one whose id is in already is left out, so the worker that appends may run twice.
 * Each append is a transaction of its own, as a mailer's send is a call of its own: it
 * is fed by `handler` workers, never inside the save of an entity.
 */
export class SqlAnalytics implements Analytics, AnalyticsCounts {

  private readonly db

  constructor(private readonly store: SqliteStore | PostgresStore) {
    this.db = kyselyFor<AnalyticsDatabase>(store)
  }

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.store.transaction(async () => {
      await this.db.insertInto('analytics_row')
        .values(rows.map(row => ({ dataset, id: row.id, data: JSON.stringify(row) })))
        .onConflict(conflict => conflict.columns(['dataset', 'id']).doNothing())
        .execute()
    })
  }

  /** A dataset's rows, by id. */
  async rows(dataset: string): Promise<AnalyticsRow[]> {
    const found = await this.db.selectFrom('analytics_row').select('data').where('dataset', '=', dataset).orderBy('id').execute()
    return found.map(row => JSON.parse(row.data) as AnalyticsRow)
  }

  async count(dataset: string): Promise<number> {
    const found = await this.db.selectFrom('analytics_row').select(eb => eb.fn.countAll<number>().as('count')).where('dataset', '=', dataset).executeTakeFirstOrThrow()
    return Number(found.count)
  }

  async countBy(dataset: string, field: string, options: { from?: string } = {}): Promise<AnalyticsCount[]> {
    if (!FIELD.test(field)) throw new Error(`'${field}' is not a field a row may have`)
    const value = this.fieldOf(field)
    const found = await this.db.selectFrom('analytics_row')
      .select(eb => [value.as('value'), eb.fn.countAll<number>().as('count')])
      .where('dataset', '=', dataset)
      .where(value, '>=', options.from ?? '')
      .groupBy(value)
      .orderBy(value)
      .execute()
    return found.map(row => ({ value: String(row.value), count: Number(row.count) }))
  }

  /** The store is the context's, which closes it: there is nothing of its own to close. */
  async close(): Promise<void> {}

  /**
   * A field of the JSON, as text: each database says it its own way (DuckDB or
   * ClickHouse would read a column). The field's name is written in the query, not
   * sent apart: Postgres groups by an expression only if it is written the same. It is
   * a name, checked above, never a piece of SQL.
   */
  private fieldOf(field: string): RawBuilder<string> {
    return this.store instanceof SqliteStore
      ? sql<string>`json_extract(data, ${sql.lit(`$.${field}`)})`
      : sql<string>`(data::jsonb ->> ${sql.lit(field)})`
  }
}
