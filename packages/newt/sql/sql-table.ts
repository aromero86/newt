import { ConcurrencyConflict, criteriaTree, DuplicateValue, type Criteria } from '../core'
import type { FieldType, FindOptions, NewRow, StoredRow, Table, TableOptions } from '../port-store'
import type { SqlDialect } from './sql-dialect'
import type { SqlExecutor } from './sql-executor'
import type { SqlTableOptions } from './sql-table-options'
import { TextWithNul } from './text-with-nul'
import { whereClause } from './where-clause'

type Values = Record<string, unknown>

/**
 * A table of a SQL store, by SQL it writes itself, in the store's dialect. Its
 * structure is the context's own, made by its migrations: an `id` primary key, a
 * `version` integer, and a column for each field, named as the field in snake case
 * unless `columns` says otherwise. A unique index makes a value unique: a row that
 * takes it is a `DuplicateValue`.
 */
export class SqlTable<Row extends StoredRow> implements Table<Row> {

  private readonly fieldOf = new Map<string, string>()

  constructor(
    private readonly executor: SqlExecutor,
    private readonly dialect: SqlDialect,
    private readonly name: string,
    private readonly options: TableOptions<Row> & SqlTableOptions<Row> = {},
    /** Its store's schema, which moves on when the store migrates it. */
    private readonly schema: { readonly generation: number } = { generation: 0 },
  ) {
    for (const [field, column] of Object.entries(options.columns ?? {})) this.fieldOf.set(column as string, field)
  }

  async find(criteria?: Criteria<Row>, options: FindOptions<Row> = {}): Promise<Row[]> {
    if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit >= 0)) throw new Error(`A limit is a whole number, 0 or more: not ${options.limit}`)
    const columns = await this.columns()
    const params: unknown[] = []
    // Null goes first going up, as in every store: said only where it may be, so a column that cannot hold it (a primary key) is ordered as its index is.
    const nulls = (column: string, direction?: 'asc' | 'desc') =>
      this.dialect.nullsLast && !(columns.all.has(column) && !columns.nullable.has(column)) ? (direction === 'desc' ? ' NULLS LAST' : ' NULLS FIRST') : ''
    const order = (options.orderBy ?? [{ field: 'id' }])
      .map(({ field, direction }) => `${this.dialect.quote(this.column(field))} ${direction === 'desc' ? 'DESC' : 'ASC'}${nulls(this.column(field), direction)}`)
      .join(', ')
    const sql = `SELECT * FROM ${this.dialect.quote(this.name)}${this.where(criteria, params)} ORDER BY ${order}${options.limit === undefined ? '' : ` LIMIT ${options.limit}`}`
    const rows = await this.executor.all(sql, params)
    // A column it has not learned of was added since (a migration): it learns them again.
    const learned = this.dialect.columns && rows[0] && Object.keys(rows[0]).some(column => !columns.all.has(column)) ? await this.columns(true) : columns
    return rows.map(row => this.decode(row, learned))
  }

  async count(criteria?: Criteria<Row>): Promise<number> {
    const params: unknown[] = []
    const [row] = await this.executor.all(`SELECT count(*) AS total FROM ${this.dialect.quote(this.name)}${this.where(criteria, params)}`, params)
    return Number(row?.total ?? 0)
  }

  async insert(row: NewRow<Row>): Promise<void> {
    const values = this.encode({ ...row, version: 1 })
    const columns = Object.keys(values)
    await this.writing(async () => {
      await this.executor.run(
        `INSERT INTO ${this.dialect.quote(this.name)} (${columns.map(this.dialect.quote).join(', ')}) VALUES (${columns.map((column, i) => this.param(column, i + 1)).join(', ')})`,
        Object.values(values),
      )
    })
  }

  async update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void> {
    const values = this.encode({ ...changes, version: version + 1 })
    delete values.id
    await this.writing(async () => {
      if (await this.set(values, id, version) === 0) throw new ConcurrencyConflict()
    })
  }

  async patch(id: string, changes: Partial<NewRow<Row>>): Promise<void> {
    const values = this.encode(changes)
    delete values.id
    delete values.version
    if (Object.keys(values).length === 0) return
    await this.writing(async () => { await this.set(values, id) })
  }

  delete(id: string, version: number): Promise<void> {
    return this.writing(async () => {
      const deleted = this.missing(id) ? 0 : await this.executor.run(`DELETE FROM ${this.dialect.quote(this.name)} WHERE id = ${this.dialect.param(1)} AND version = ${this.dialect.param(2)}`, [id, version])
      if (deleted === 0) throw new ConcurrencyConflict()
    })
  }

  async deleteMany(criteria: Criteria<Row>): Promise<number> {
    const params: unknown[] = []
    return this.writing(() => this.executor.run(`DELETE FROM ${this.dialect.quote(this.name)}${this.where(criteria, params)}`, params))
  }

  /** Writes columns of the row with this id (and this version, when given); how many rows it changed. */
  private async set(values: Values, id: string, version?: number): Promise<number> {
    if (this.missing(id)) return 0
    const columns = Object.keys(values)
    const params = [...Object.values(values), id, ...(version === undefined ? [] : [version])]
    const sets = columns.map((column, i) => `${this.dialect.quote(column)} = ${this.param(column, i + 1)}`).join(', ')
    const where = `id = ${this.dialect.param(columns.length + 1)}${version === undefined ? '' : ` AND version = ${this.dialect.param(columns.length + 2)}`}`
    return this.executor.run(`UPDATE ${this.dialect.quote(this.name)} SET ${sets} WHERE ${where}`, params)
  }

  /** The n-th parameter, written to a column: as JSON, where the dialect says how. */
  private param(column: string, n: number): string {
    const param = this.dialect.param(n)
    return this.type(this.field(column)) === 'json' && this.dialect.json ? this.dialect.json(param) : param
  }

  /** A write in the transaction in progress, or one of its own; a collision is a `DuplicateValue` there and then. */
  private writing<T>(fn: () => Promise<T>): Promise<T> {
    return this.executor.transaction(async () => {
      try {
        return await fn()
      } catch (error) {
        throw this.dialect.isCollision(error) ? new DuplicateValue((this.dialect.collidingColumns?.(error) ?? []).map(column => this.field(column))) : error
      }
    })
  }

  private where(criteria: Criteria<Row> | undefined, params: unknown[]): string {
    const clause = whereClause(criteriaTree(criteria), {
      dialect: this.dialect,
      column: field => this.column(field),
      value: (field, operand) => this.encodeValue(field, operand),
    }, params)
    return clause === this.dialect.always ? '' : ` WHERE ${clause}`
  }

  /**
   * What the table learned of its columns, where its dialect asks (Postgres): once,
   * unless the table is not there yet, its store migrated since, or `again` (a column
   * it has not seen came back: another process migrated it).
   */
  private columns(again = false): Promise<Columns> {
    if (!this.dialect.columns) return Promise.resolve(NOTHING_LEARNED)
    if (again || this.learnedAt !== this.schema.generation) this.learning = undefined
    this.learnedAt = this.schema.generation
    this.learning ??= this.executor.all(this.dialect.columns, [this.dialect.quote(this.name)]).then(rows => {
      if (rows.length === 0) this.learning = undefined
      const which = (key: string) => new Set(rows.filter(row => row[key]).map(row => String(row.name)))
      return { all: new Set(rows.map(row => String(row.name))), nullable: which('nullable'), big: which('big'), json: which('json') }
    }, (error: unknown) => {
      this.learning = undefined
      throw error
    })
    return this.learning
  }

  private learning?: Promise<Columns>
  private learnedAt = 0

  private column(field: string): string {
    return (this.options.columns as Record<string, string> | undefined)?.[field] ?? field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
  }

  private field(column: string): string {
    return this.fieldOf.get(column) ?? column.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
  }

  private type(field: string): FieldType | undefined {
    return (this.options.types as Record<string, FieldType> | undefined)?.[field]
  }

  /** An id no row can have: one with NUL, where text cannot hold it. */
  private missing(id: string): boolean {
    return this.dialect.refusesNul === true && id.includes('\u0000')
  }

  private encode(row: Values): Values {
    const values = Object.fromEntries(Object.entries(row)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [this.column(field), this.encodeValue(field, value)]))
    if (this.dialect.refusesNul && Object.values(values).some(value => typeof value === 'string' && value.includes('\u0000'))) throw new TextWithNul()
    return values
  }

  private encodeValue(field: string, value: unknown): unknown {
    if (value === null || value === undefined) return null
    switch (this.type(field)) {
      case 'boolean': return this.dialect.boolean(Boolean(value))
      case 'json': return JSON.stringify(value)
      default: return value
    }
  }

  private decode(row: Values, columns: Columns): Row {
    return Object.fromEntries(Object.entries(row).map(([column, value]) => {
      const field = this.field(column)
      if (value === null) return [field, null]
      switch (this.type(field)) {
        case 'boolean': return [field, value === 1 || value === true || value === '1']
        // A driver that parses JSON already hands a JSON string back as a string: parsing it again would spoil it. A column
        // of text it hands back as it is: where the table knows its column is not JSON (Postgres), it parses it.
        case 'json': return [field, typeof value === 'string' && (!this.dialect.parsesJson || (columns.all.has(column) && !columns.json.has(column))) ? JSON.parse(value) : value]
        default: return [field, columns.big.has(column) ? bigInteger(value) : typeof value === 'bigint' ? Number(value) : value]
      }
    })) as Row
  }
}

/** What a table knows of its columns: all of them, and those that may hold null, its big integers, its JSON. */
type Columns = { all: Set<string>, nullable: Set<string>, big: Set<string>, json: Set<string> }

const NOTHING_LEARNED: Columns = { all: new Set(), nullable: new Set(), big: new Set(), json: new Set() }

/** A big integer the driver hands back as text, as a number while it is exact (as MySQL's does); as text beyond. */
function bigInteger(value: unknown): unknown {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
}
