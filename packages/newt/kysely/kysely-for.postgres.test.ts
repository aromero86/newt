import { describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { PostgresStore } from '../adapter-postgres'
import { kyselyFor } from './kysely-for'

/**
 * A Postgres to test against, when there is one: `FRAMEWORK_TEST_POSTGRES_URL`. Without
 * it, this test is skipped. Its `public` schema is dropped and made again: a database
 * of its own, never one that matters.
 */
const url = process.env.FRAMEWORK_TEST_POSTGRES_URL

/** A fresh database with a table of things. */
async function open(): Promise<PostgresStore> {
  const admin = new SQL(url!)
  await admin.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await admin.unsafe(`CREATE TABLE thing (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, archived BOOLEAN NOT NULL, rank DOUBLE PRECISION NOT NULL,
    note TEXT, tags JSONB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL
  )`)
  await admin.close()
  return PostgresStore.open({ url: url!, connections: 5 })
}

if (url) {
  describe('Kysely on a PostgresStore', () => {
    test('queries with the rows\' field names, in the store\'s transaction', async () => {
      const store = await open()
      try {
        const db = kyselyFor<{ thing: { id: string, workspaceId: string, rank: number } }>(store)
        await store.table<{ id: string, version: number, workspaceId: string, name: string, archived: boolean, rank: number, note: null, tags: string[], createdAt: string, updatedAt: string, deletedAt: null }>('thing', { types: { tags: 'json' } })
          .insert({ id: 't1', workspaceId: 'w1', name: 'a', archived: false, rank: 2, note: null, tags: [], createdAt: '', updatedAt: '', deletedAt: null })
        const rows = await db.selectFrom('thing').select(['id', 'workspaceId']).where('rank', '>', 1).execute()
        expect(rows).toEqual([{ id: 't1', workspaceId: 'w1' }])
      } finally {
        await store.close()
      }
    })

    test('reads a json field the table wrote as the object it is', async () => {
      const store = await open()
      try {
        const db = kyselyFor<{ thing: { id: string, tags: unknown } }>(store)
        await store.table<{ id: string, version: number, workspaceId: string, name: string, archived: boolean, rank: number, note: null, tags: unknown, createdAt: string, updatedAt: string, deletedAt: null }>('thing', { types: { tags: 'json' } })
          .insert({ id: 't1', workspaceId: 'w1', name: 'a', archived: false, rank: 2, note: null, tags: { colour: 'red', sizes: [1, 2] }, createdAt: '', updatedAt: '', deletedAt: null })

        expect(await db.selectFrom('thing').select(['id', 'tags']).execute()).toEqual([{ id: 't1', tags: { colour: 'red', sizes: [1, 2] } }])
      } finally {
        await store.close()
      }
    })

    test('writes in the store\'s transaction, undone with it, and refuses transactions of its own', async () => {
      const store = await open()
      try {
        const db = kyselyFor<{ thing: { id: string, workspaceId: string, name: string, archived: boolean, rank: number, tags: string[], createdAt: string, updatedAt: string, version: number } }>(store)
        const thing = (id: string) => ({ id, workspaceId: 'w1', name: id, archived: false, rank: 0, tags: [], createdAt: '', updatedAt: '', version: 1 })

        await store.transaction(async () => {
          await db.insertInto('thing').values(thing('t1')).execute()
          expect(await db.selectFrom('thing').select('id').execute()).toEqual([{ id: 't1' }])
        })
        await expect(store.transaction(async () => {
          await db.insertInto('thing').values(thing('t2')).execute()
          throw new Error('undone')
        })).rejects.toThrow('undone')

        expect(await db.selectFrom('thing').select('id').execute()).toEqual([{ id: 't1' }])
        await expect(db.transaction().execute(async () => {})).rejects.toThrow('store.transaction')
      } finally {
        await store.close()
      }
    })
  })
} else {
  test.skip('Kysely on a PostgresStore: set FRAMEWORK_TEST_POSTGRES_URL to run it', () => {})
}
