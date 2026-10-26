import { expect } from 'bun:test'
import type { Kysely } from 'kysely'
import type { Criteria } from '../core'
import type { Table } from '../port-store'
import { whereOf } from './where-of'
import type { SqliteStore } from '../adapter-sqlite'
import type { SqlStore } from '../sql'

/** The rows `whereOf` is checked on, in a `pick` table: `id`, `name`, `archived` (a boolean) and `note`, which may be null. */
export type PickRow = { id: string, name: string, archived: boolean, note: string | null, version: number }

const ROWS: Omit<PickRow, 'version'>[] = [
  { id: '01', name: 'Ana', archived: false, note: null },
  { id: '02', name: 'bea', archived: true, note: 'x' },
  { id: '03', name: 'cris', archived: false, note: 'y' },
  { id: '04', name: 'ANA', archived: true, note: 'x' },
]

const CASES: Criteria<PickRow>[] = [
  {},
  { name: 'bea' },
  { archived: false },
  { archived: true, note: 'x' },
  { note: null },
  { note: { ne: null } },
  { note: { ne: 'x' } },
  { id: { in: ['03', '01'] } },
  { id: { in: [] } },
  { note: { in: ['y', null] } },
  { id: { gt: '01', lte: '03' } },
  { name: { lt: 'bea' } },
  { name: { ieq: 'ana' } },
  { name: 'bea\u0000' },
  { or: [{ name: 'cris' }, { note: null }] },
  { or: [] },
  { and: [{ archived: true }, { or: [{ note: 'x' }, { name: 'cris' }] }] },
]

/** Fills `pick` and checks Kysely, given `whereOf`, finds the rows its table finds, for every case. */
export async function expectWhereOfFindsAsTables(store: SqliteStore | SqlStore, db: Kysely<{ pick: { id: string } }>, table: Table<PickRow>): Promise<void> {
  for (const row of ROWS) await table.insert(row)
  for (const criteria of CASES) {
    const found = (await table.find(criteria)).map(row => row.id)
    const queried = (await db.selectFrom('pick').select('id').where(whereOf(store, criteria)).orderBy('id').execute()).map(row => row.id)
    expect({ criteria, ids: queried }).toEqual({ criteria, ids: found })
  }
}
