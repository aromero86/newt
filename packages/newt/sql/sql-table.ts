import { ConcurrencyConflict, criteriaTree, type Criteria } from '../core'
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
 * takes it is a `ConcurrencyConflict`.
 */
export class SqlTable<Row extends StoredRow> implements Table<Row> {

  private readonly fieldOf = new Map<string, string>()

  constructor(
    private readonly executor: SqlExecutor,
    private readonly dialect: SqlDialect,
    private readonly name: string,
    private readonly options: TableOptions<Row> & SqlTableOptions<Row> = {},
  ) {
    for (const [field, column] of Object.entries(options.columns ?? {})) this.fieldOf.set(column as string, field)
  }

  async find(criteria?: Criteria<Row>, options: FindOptions<Row> = {}): Promise<Row[]> {
    if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit >= 0)) throw new Error(`A limit is a whole number, 0 or more: not ${options.limit}`)
    const columns = await this.columns()
    const params: unknown[] = []
    const nulls = (direction?: 'asc' | 'desc') => (this.dialect.nullsLast ? (direction === 'desc' ? ' NULLS LAST' : ' NULLS FIRST') : '')
    const order = (options.orderBy ?? [{ field: 'id' }])
      .map(({ field, direction }) => `${this.ordered(columns, this.column(field), this.dialect.quote(this.column(field)))} ${direction === 'desc' ? 'DESC' : 'ASC'}${nulls(direction)}`)
      .join(', ')
    const sql = `SELECT * FROM ${this.dialect.quote(this.name)}${this.where(criteria, params, columns)} ORDER BY ${order}${options.limit === undefined ? '' : ` LIMIT ${options.limit}`}`
    return (await this.executor.all(sql, params)).map(row => this.decode(row, columns))
  }

  async count(criteria?: Criteria<Row>): Promise<number> {
    const columns = await this.columns()
    const params: unknown[] = []
    const [row] = await this.executor.all(`SELECT count(*) AS total FROM ${this.dialect.quote(this.name)}${this.where(criteria, params, columns)}`, params)
    return Number(row?.total ?? 0)
  }

  async insert(row: NewRow<Row>): Promise<void> {
    const values = this.encode({ ...row, version: 1 })
    const columns = Object.keys(values)
    await this.writing(async () => {
      await this.executor.run(
        `INSERT INTO ${this.dialect.quote(this.name)} (${columns.map(this.dialect.quote).join(', ')}) VALUES (${columns.map((_, i) => this.dialect.param(i + 1)).join(', ')})`,
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

  /** Writes columns of the row with this id (and this version, when given); how many rows it changed. */
  private async set(values: Values, id: string, version?: number): Promise<number> {
    if (this.missing(id)) return 0
    const columns = Object.keys(values)
    const params = [...Object.values(values), id, ...(version === undefined ? [] : [version])]
    const sets = columns.map((column, i) => `${this.dialect.quote(column)} = ${this.dialect.param(i + 1)}`).join(', ')
    const where = `id = ${this.dialect.param(columns.length + 1)}${version === undefined ? '' : ` AND version = ${this.dialect.param(columns.length + 2)}`}`
    return this.executor.run(`UPDATE ${this.dialect.quote(this.name)} SET ${sets} WHERE ${where}`, params)
  }

  /** A write in the transaction in progress, or one of its own; a collision is a `ConcurrencyConflict` there and then. */
  private writing(fn: () => Promise<void>): Promise<void> {
    return this.executor.transaction(async () => {
      try {
        await fn()
      } catch (error) {
        throw this.dialect.isCollision(error) ? new ConcurrencyConflict() : error
      }
    })
  }

  private where(criteria: Criteria<Row> | undefined, params: unknown[], columns: Columns): string {
    const clause = whereClause(criteriaTree(criteria), {
      dialect: this.dialect,
      column: field => this.column(field),
      value: (field, operand) => this.encodeValue(field, operand),
      ordered: (field, quoted) => this.ordered(columns, this.column(field), quoted),
    }, params)
    return clause === this.dialect.always ? '' : ` WHERE ${clause}`
  }

  /** A column as it is compared by order: by code point, where the database's own collation would not. */
  private ordered(columns: Columns, column: string, quoted: string): string {
    return columns.collated.has(column) && this.dialect.byCodePoint ? this.dialect.byCodePoint(quoted) : quoted
  }

  /** What the table learned of its columns, where its dialect asks (Postgres): once, unless the table is not there yet. */
  private columns(): Promise<Columns> {
    if (!this.dialect.columns) return Promise.resolve(NOTHING_LEARNED)
    this.learning ??= this.executor.all(this.dialect.columns, [this.dialect.quote(this.name)]).then(rows => {
      if (rows.length === 0) this.learning = undefined
      return {
        collated: new Set(rows.filter(row => row.collated).map(row => String(row.name))),
        big: new Set(rows.filter(row => row.big).map(row => String(row.name))),
      }
    }, (error: unknown) => {
      this.learning = undefined
      throw error
    })
    return this.learning
  }

  private learning?: Promise<Columns>

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
        // A driver that parses JSON already hands a JSON string back as a string: parsing it again would spoil it.
        case 'json': return [field, typeof value === 'string' && !this.dialect.parsesJson ? JSON.parse(value) : value]
        default: return [field, columns.big.has(column) ? bigInteger(value) : typeof value === 'bigint' ? Number(value) : value]
      }
    })) as Row
  }
}

/** What a table knows of its columns: those it compares by code point, and its big integers. */
type Columns = { collated: Set<string>, big: Set<string> }

const NOTHING_LEARNED: Columns = { collated: new Set(), big: new Set() }

/** A big integer the driver hands back as text, as a number while it is exact (as MySQL's does); as text beyond. */
function bigInteger(value: unknown): unknown {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
}
