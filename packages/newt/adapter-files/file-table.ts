import { compare, ConcurrencyConflict, matches, type Criteria } from '../core'
import type { FindOptions, NewRow, StoredRow, Table, TableOptions } from '../port-store'
import type { FileCollection } from './file-collection'
import type { FileRecord } from './file-record'

/**
 * A table of a files store: its rows are a collection's records, found by reading them
 * all. Each write checks and writes in one turn of its transaction, so two writes
 * awaited together in one transaction do not both pass the same check.
 */
export class FileTable<Row extends StoredRow> implements Table<Row> {

  constructor(private readonly records: FileCollection, private readonly options: TableOptions<Row> = {}) {}

  async find(criteria?: Criteria<Row>, options: FindOptions<Row> = {}): Promise<Row[]> {
    if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit >= 0)) throw new Error(`A limit is a whole number, 0 or more: not ${options.limit}`)
    const order = options.orderBy ?? [{ field: 'id' }]
    const rows = (await this.rows())
      .filter(row => matches(row, criteria))
      .sort((a, b) => {
        for (const { field, direction } of order) {
          const by = compare(a[field as keyof Row], b[field as keyof Row])
          if (by !== 0) return direction === 'desc' ? -by : by
        }
        return 0
      })
    return options.limit === undefined ? rows : rows.slice(0, options.limit)
  }

  async count(criteria?: Criteria<Row>): Promise<number> {
    return (await this.rows()).filter(row => matches(row, criteria)).length
  }

  insert(row: NewRow<Row>): Promise<void> {
    return this.inTurn(async () => {
      const stored: FileRecord = { ...defined(row), id: row.id, version: 1 }
      if (await this.records.get(stored.id)) throw new ConcurrencyConflict()
      await this.assertUnique(stored)
      await this.records.put(stored)
    })
  }

  update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void> {
    return this.inTurn(async () => {
      const current = await this.records.get(id)
      if (current?.version !== version) throw new ConcurrencyConflict()
      const next = { ...current, ...defined(changes), id, version: version + 1 }
      await this.assertUnique(next)
      await this.records.put(next)
    })
  }

  patch(id: string, changes: Partial<NewRow<Row>>): Promise<void> {
    return this.inTurn(async () => {
      const current = await this.records.get(id)
      if (!current) return
      const { id: _, version: __, ...fields } = defined(changes)
      const next = { ...current, ...fields }
      await this.assertUnique(next)
      await this.records.put(next)
    })
  }

  delete(id: string, version: number): Promise<void> {
    return this.inTurn(async () => {
      const current = await this.records.get(id)
      if (current?.version !== version) throw new ConcurrencyConflict()
      await this.records.remove(id)
    })
  }

  private inTurn(fn: () => Promise<void>): Promise<void> {
    const store = this.records.store
    return store.transaction(() => store.serially(fn))
  }

  private async rows(): Promise<Row[]> {
    return (await this.records.all()) as unknown as Row[]
  }

  /** No other row has its value in any unique set of fields; a field without one, or a row deleted, shares nothing. */
  private async assertUnique(row: FileRecord): Promise<void> {
    if (isDeleted(row)) return
    const sets = (this.options.unique ?? []).filter(fields => fields.every(field => row[field] !== null && row[field] !== undefined))
    if (sets.length === 0) return
    const others = (await this.records.all()).filter(other => other.id !== row.id && !isDeleted(other))
    for (const fields of sets) {
      if (others.some(other => fields.every(field => other[field] === row[field]))) throw new ConcurrencyConflict()
    }
  }
}

function isDeleted(row: FileRecord): boolean {
  return row.deletedAt !== null && row.deletedAt !== undefined
}

function defined(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}
