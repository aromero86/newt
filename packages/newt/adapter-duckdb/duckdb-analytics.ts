import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api'
import type { Analytics, AnalyticsRow } from '../port-analytics'

/** The types a declared dataset's columns may have. */
export type DuckDbColumnType = 'VARCHAR' | 'INTEGER' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP' | 'DATE' | 'JSON'

/** A dataset with columns of its own: its rows are read as columns, which is what DuckDB is fast at. */
export type DuckDbDataset = { columns: Record<string, DuckDbColumnType> }

export type DuckDbAnalyticsOptions = {
  /** Its file, made with its folder if missing, or `:memory:`. */
  path: string
  /** Datasets with columns of their own. Any other is kept whole, each row as JSON. */
  datasets?: Record<string, DuckDbDataset>
}

/** A dataset's or a column's name: letters, digits and `_`, never a piece of SQL. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A value a query may be given. */
export type DuckDbParam = string | number | boolean | null

/**
 * newt's analytics port on DuckDB, a database made for reading a lot at once: in a
 * file of its own, in the one process that writes it (DuckDB lets no other open it to
 * write meanwhile). A dataset declared with its columns is a table of them; any other
 * keeps each row whole, as JSON. Rows are only added, and one whose id is in already is
 * left out (`describeAnalyticsContract`), so a worker that appends may run twice.
 *
 * Reading is the adapter's own: `query`, in DuckDB's SQL, which groups by time
 * (`time_bucket`) as it reads. `run` is for keeping it, such as forgetting what is old:
 * never for changing what a row said.
 */
export class DuckDbAnalytics implements Analytics {

  /** Every statement, one after another: the connection runs one at a time. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly created = new Set<string>()
  private closing: Promise<void> | null = null

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
    private readonly datasets: Record<string, DuckDbDataset>,
  ) {}

  static async open({ path, datasets = {} }: DuckDbAnalyticsOptions): Promise<DuckDbAnalytics> {
    for (const [name, dataset] of Object.entries(datasets)) {
      for (const column of [name, ...Object.keys(dataset.columns)]) {
        if (!NAME.test(column)) throw new Error(`'${column}' is not a name a dataset or a column may have`)
      }
      if ('id' in dataset.columns) throw new Error(`${name}: 'id' is every row's, not a column to declare`)
    }
    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true })
    const instance = await DuckDBInstance.create(path)
    const analytics = new DuckDbAnalytics(instance, await instance.connect(), datasets)
    for (const name of Object.keys(datasets)) await analytics.ensure(name)
    return analytics
  }

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.ensure(dataset)
    const declared = this.datasets[dataset]
    const columns = declared ? ['id', ...Object.keys(declared.columns)] : ['id', 'data']
    const values = (row: AnalyticsRow): DuckDbParam[] => declared
      ? [row.id, ...Object.keys(declared.columns).map(column => toParam(row[column], declared.columns[column]!))]
      : [row.id, JSON.stringify(row)]
    // In batches: one statement per thousand rows keeps its parameters few.
    for (let start = 0; start < rows.length; start += 1000) {
      const batch = rows.slice(start, start + 1000)
      const placeholders = batch.map((_, row) => `(${columns.map((__, column) => `$${row * columns.length + column + 1}`).join(', ')})`).join(', ')
      await this.run(`INSERT INTO ${dataset} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`, batch.flatMap(values))
    }
  }

  /** Rows of a query, in DuckDB's SQL: times as ISO strings, whole numbers as numbers. */
  query<T = Record<string, unknown>>(sql: string, params: DuckDbParam[] = []): Promise<T[]> {
    return this.serially(async () => {
      const result = await this.connection.runAndReadAll(sql, params)
      return result.getRowObjectsJS().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromDuck(value)])) as T)
    })
  }

  /** A statement that keeps it (forgetting what is old, summing it into another dataset), with its parameters. */
  run(sql: string, params: DuckDbParam[] = []): Promise<void> {
    return this.serially(async () => {
      await this.connection.run(sql, params)
    })
  }

  /** A dataset's rows, whole: for tests, and datasets kept as JSON. */
  async rows(dataset: string): Promise<AnalyticsRow[]> {
    await this.ensure(dataset)
    if (this.datasets[dataset]) return this.query<AnalyticsRow>(`SELECT * FROM ${dataset} ORDER BY id`)
    const found = await this.query<{ data: string }>(`SELECT data FROM ${dataset} ORDER BY id`)
    return found.map(row => JSON.parse(row.data) as AnalyticsRow)
  }

  /**
   * Closes it once the statements already given have run, however often it is called.
   * A statement given after fails: on a closed connection DuckDB's native code would
   * take the whole process down.
   */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.queue.catch(() => undefined)
      this.connection.closeSync()
      this.instance.closeSync()
    })()
    return this.closing
  }

  private async ensure(dataset: string): Promise<void> {
    if (this.created.has(dataset)) return
    if (!NAME.test(dataset)) throw new Error(`'${dataset}' is not a name a dataset may have`)
    const declared = this.datasets[dataset]
    const columns = declared
      ? Object.entries(declared.columns).map(([name, type]) => `${name} ${type}`)
      : ['data JSON NOT NULL']
    await this.run(`CREATE TABLE IF NOT EXISTS ${dataset} (id VARCHAR PRIMARY KEY, ${columns.join(', ')})`)
    this.created.add(dataset)
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('The analytics is closed: no statement runs on it any more'))
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }
}

/** A row's value for a column of a declared dataset. */
function toParam(value: unknown, type: DuckDbColumnType): DuckDbParam {
  if (value === undefined || value === null) return null
  if (type === 'JSON') return JSON.stringify(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

/** A value DuckDB gives, as the rest of newt has it. */
function fromDuck(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return Number(value)
  return value as DuckDBValue
}
