import { expect, test } from 'bun:test'
import { SqliteStore } from '../adapter-sqlite'
import { kyselyFor } from './kysely-for'
import { whereOf } from './where-of'
import { expectWhereOfFindsAsTables, type PickRow } from './where-of.cases'

async function open(): Promise<SqliteStore> {
  const store = await SqliteStore.open({ path: ':memory:' })
  await store.transaction(() => store.connection.run('CREATE TABLE pick (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL, note TEXT, version INTEGER NOT NULL)'))
  return store
}

test('whereOf finds with Kysely the rows the table finds, by the same criteria', async () => {
  const store = await open()
  try {
    await expectWhereOfFindsAsTables(store, kyselyFor(store), store.table<PickRow>('pick', { types: { archived: 'boolean' } }))
  } finally {
    await store.close()
  }
})

test('whereOf names the fields as Kysely does, beside conditions of its own', async () => {
  const store = await open()
  try {
    const db = kyselyFor<{ pick: { id: string, name: string, archivedAt: string } }>(store)
    const { sql } = db.selectFrom('pick').select('id').where('name', '=', 'ana').where(whereOf(store, { archivedAt: null, id: { in: ['a', 'b'] } })).compile()

    expect(sql).toBe('select "id" from "pick" where "name" = ? and ("archived_at" IS NULL AND "id" IN (?, ?))')
  } finally {
    await store.close()
  }
})
