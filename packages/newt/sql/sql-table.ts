import { ConcurrencyConflict, criteriaTree, type Criteria } from '../core'
import type { FieldType, FindOptions, NewRow, StoredRow, Table, TableOptions } from '../store'
import type { SqlDialect } from './sql-dialect'
import type { SqlExecutor } from './sql-executor'
import type { SqlTableOptions } from './sql-table-options'
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
    const params: unknown[] = []
    const order = (options.orderBy ?? [{ field: 'id' }])
      .map(({ field, direction }) => `${this.dialect.quote(this.column(field))} ${direction === 'desc' ? 'DESC' : 'ASC'}`)
      .join(', ')
    const sql = `SELECT * FROM ${this.dialect.quote(this.name)}${this.where(criteria, params)} ORDER BY ${order}${options.limit === undefined ? '' : ` LIMIT ${options.limit}`}`
    return (await this.executor.all(sql, params)).map(row => this.decode(row))
  }

  async count(criteria?: Criteria<Row>): Promise<number> {
    const params: unknown[] = []
    const [row] = await this.executor.all(`SELECT count(*) AS total FROM ${this.dialect.quote(this.name)}${this.where(criteria, params)}`, params)
    return Number(row?.total ?? 0)
  }

  insert(row: NewRow<Row>): Promise<void> {
    const values = this.encode({ ...row, version: 1 })
    const columns = Object.keys(values)
    return this.writing(async () => {
      await this.executor.run(
        `INSERT INTO ${this.dialect.quote(this.name)} (${columns.map(this.dialect.quote).join(', ')}) VALUES (${columns.map((_, i) => this.dialect.param(i + 1)).join(', ')})`,
        Object.values(values),
      )
    })
  }

  update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void> {
    const values = this.encode({ ...changes, version: version + 1 })
    delete values.id
    return this.writing(async () => {
      if (await this.set(values, id, version) === 0) throw new ConcurrencyConflict()
    })
  }

  patch(id: string, changes: Partial<NewRow<Row>>): Promise<void> {
    const values = this.encode(changes)
    delete values.id
    delete values.version
    if (Object.keys(values).length === 0) return Promise.resolve()
    return this.writing(async () => { await this.set(values, id) })
  }

  delete(id: string, version: number): Promise<void> {
    return this.writing(async () => {
      const deleted = await this.executor.run(`DELETE FROM ${this.dialect.quote(this.name)} WHERE id = ${this.dialect.param(1)} AND version = ${this.dialect.param(2)}`, [id, version])
      if (deleted === 0) throw new ConcurrencyConflict()
    })
  }

  /** Writes columns of the row with this id (and this version, when given); how many rows it changed. */
  private set(values: Values, id: string, version?: number): Promise<number> {
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

  private where(criteria: Criteria<Row> | undefined, params: unknown[]): string {
    const clause = whereClause(criteriaTree(criteria), { dialect: this.dialect, column: field => this.column(field), value: (field, operand) => this.encodeValue(field, operand) }, params)
    return clause === this.dialect.always ? '' : ` WHERE ${clause}`
  }

  private column(field: string): string {
    return (this.options.columns as Record<string, string> | undefined)?.[field] ?? field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
  }

  private field(column: string): string {
    return this.fieldOf.get(column) ?? column.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
  }

  private type(field: string): FieldType | undefined {
    return (this.options.types as Record<string, FieldType> | undefined)?.[field]
  }

  private encode(row: Values): Values {
    return Object.fromEntries(Object.entries(row)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [this.column(field), this.encodeValue(field, value)]))
  }

  private encodeValue(field: string, value: unknown): unknown {
    if (value === null || value === undefined) return null
    switch (this.type(field)) {
      case 'boolean': return this.dialect.boolean(Boolean(value))
      case 'json': return JSON.stringify(value)
      default: return value
    }
  }

  private decode(row: Values): Row {
    return Object.fromEntries(Object.entries(row).map(([column, value]) => {
      const field = this.field(column)
      if (value === null) return [field, null]
      switch (this.type(field)) {
        case 'boolean': return [field, value === 1 || value === true || value === '1']
        case 'json': return [field, typeof value === 'string' ? JSON.parse(value) : value]
        default: return [field, typeof value === 'bigint' ? Number(value) : value]
      }
    })) as Row
  }
}
