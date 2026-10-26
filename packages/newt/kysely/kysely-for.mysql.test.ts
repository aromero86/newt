import { describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { MySqlStore } from '../adapter-mysql'
import { kyselyFor } from './kysely-for'

/**
 * A MySQL to test against, when there is one: `FRAMEWORK_TEST_MYSQL_URL`. Without it,
 * this test is skipped. Its database is dropped and made again: a database of its own,
 * never one that matters.
 */
const url = process.env.FRAMEWORK_TEST_MYSQL_URL
/** The database the URL names: the tests drop and make it again, so it is theirs alone. */
const database = url ? new URL(url).pathname.slice(1) : ''
/** The same server with no database named: one that may not exist yet cannot be signed in to. */
const server = url ? Object.assign(new URL(url), { pathname: '/' }).href : ''

/** A fresh database with a table of things. */
async function open(): Promise<MySqlStore> {
  const admin = new SQL(server)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`)
  await admin.unsafe(`CREATE DATABASE ${database}`)
  await admin.unsafe(`CREATE TABLE ${database}.thing (
    id VARCHAR(36) COLLATE utf8mb4_0900_bin PRIMARY KEY, workspace_id VARCHAR(64) COLLATE utf8mb4_0900_bin NOT NULL, \`rank\` DOUBLE NOT NULL
  )`)
  await admin.close()
  return MySqlStore.open({ url: url!, connections: 5 })
}

type Database = { thing: { id: string, workspaceId: string, rank: number } }

if (url) {
  describe('Kysely on a MySqlStore', () => {
    test('queries with the rows\' field names, and writes in the store\'s transaction, undone with it', async () => {
      const store = await open()
      try {
        const db = kyselyFor<Database>(store)
        await store.transaction(async () => {
          await db.insertInto('thing').values({ id: 't1', workspaceId: 'w1', rank: 2 }).execute()
          expect(await db.selectFrom('thing').select('id').execute()).toEqual([{ id: 't1' }])
        })
        const rows = await db.selectFrom('thing').select(['id', 'workspaceId']).where('rank', '>', 1).execute()
        expect(rows).toEqual([{ id: 't1', workspaceId: 'w1' }])
        await expect(store.transaction(async () => {
          await db.insertInto('thing').values({ id: 't2', workspaceId: 'w1', rank: 3 }).execute()
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
  test.skip('Kysely on a MySqlStore: set FRAMEWORK_TEST_MYSQL_URL to run it', () => {})
}
