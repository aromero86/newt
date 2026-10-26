import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { SQL } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConcurrencyConflict } from '../core'
import { describeStoreContract } from '../port-store/contract'
import { MySqlStore } from './mysql-store'

/**
 * A MySQL to test against, when there is one: `FRAMEWORK_TEST_MYSQL_URL`. Without it,
 * these tests are skipped. Its database is dropped and made again for every test: a
 * database of its own, never one that matters. MySQL 8.4 signs in over TLS only
 * (`mysql://root:test@127.0.0.1:3306/framework?sslmode=require`).
 */
const url = process.env.FRAMEWORK_TEST_MYSQL_URL
/** The database the URL names: the tests drop and make it again, so it is theirs alone. */
const database = url ? new URL(url).pathname.slice(1) : ''
/** The same server with no database named: one that may not exist yet cannot be signed in to. */
const server = url ? Object.assign(new URL(url), { pathname: '/' }).href : ''

const THING = `
CREATE TABLE thing (
  id VARCHAR(36) COLLATE utf8mb4_bin PRIMARY KEY, workspace_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL, name VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  archived BOOLEAN NOT NULL, \`rank\` DOUBLE NOT NULL, note TEXT COLLATE utf8mb4_bin, tags JSON NOT NULL, created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL, deleted_at VARCHAR(32), version INTEGER NOT NULL,
  UNIQUE INDEX thing_name ((IF(deleted_at IS NULL, name, NULL)))
)`

const folders: string[] = []
afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true })
})

/** A fresh, empty database: dropped and made again. */
async function empty(): Promise<void> {
  const admin = new SQL(server)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`)
  await admin.unsafe(`CREATE DATABASE ${database}`)
  await admin.close()
}

/** A folder of migrations: the thing table, and whatever else is given. */
async function migrations(more: Record<string, string> = {}): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'framework-mysql-'))
  folders.push(folder)
  await Bun.write(join(folder, '00001_thing_up.sql'), THING)
  await Bun.write(join(folder, '00001_thing_down.sql'), 'DROP TABLE thing')
  for (const [file, sql] of Object.entries(more)) await Bun.write(join(folder, file), sql)
  return folder
}

/** A fresh, empty database for each test, migrated. */
async function open(options: { waitTimeoutMs?: number } = {}): Promise<MySqlStore> {
  await empty()
  return MySqlStore.open({ url: url!, migrations: await migrations(), connections: 5, ...options })
}

if (url) {
  describeStoreContract('MySqlStore', { open })

  describe('MySqlStore', () => {
    const two = "INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, NULL, '[]', '', '', NULL, 1), ('b', 'w', 'b', false, 0, NULL, '[]', '', '', NULL, 1)"

    test('a deadlock the database gives up is a ConcurrencyConflict', async () => {
      const store = await open()
      try {
        await store.transaction(() => store.query(two))
        const cross = (first: string, second: string) => store.transaction(async () => {
          await store.query('UPDATE thing SET `rank` = `rank` + 1 WHERE id = ?', [first])
          await Bun.sleep(100)
          await store.query('UPDATE thing SET `rank` = `rank` + 1 WHERE id = ?', [second])
        })

        const outcomes = await Promise.allSettled([cross('a', 'b'), cross('b', 'a')])

        expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
        expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: expect.any(ConcurrencyConflict) })
      } finally {
        await store.close()
      }
    })

    test('a collision raised by its own SQL inside a transaction is a ConcurrencyConflict', async () => {
      const store = await open()
      try {
        const add = () => store.query("INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, NULL, '[]', '', '', NULL, 1)")
        await store.transaction(add)

        await expect(store.transaction(add)).rejects.toThrow(ConcurrencyConflict)
      } finally {
        await store.close()
      }
    })

    test('a guard another transaction holds is given up on, saying why, once it waited long enough', async () => {
      // GET_LOCK waits whole seconds: at least one.
      const store = await open({ waitTimeoutMs: 100 })
      try {
        const holding = store.transaction(async () => {
          await store.guard(['k'])
          await Bun.sleep(2_000)
        })
        await Bun.sleep(50)

        await expect(store.transaction(() => store.guard(['k']))).rejects.toThrow("the guard 'k'")
        await holding
      } finally {
        await store.close()
      }
    })

    test('runs transactions that guard different keys side by side', async () => {
      const store = await open()
      try {
        const log: string[] = []
        const hold = (key: string) => store.transaction(async () => {
          await store.guard([key])
          log.push(`in ${key}`)
          await Bun.sleep(50)
          log.push(`out ${key}`)
        })
        await Promise.all([hold('a'), hold('b')])
        expect(log.slice(0, 2).sort()).toEqual(['in a', 'in b'])
      } finally {
        await store.close()
      }
    })
  })

  describe('MySqlStore migrations', () => {
    test('apply its own first, then the framework\'s: its own may have made the job tables', async () => {
      await empty()
      const folder = await migrations({
        '00002_queues_up.sql': 'CREATE TABLE job_queue (name VARCHAR(255) COLLATE utf8mb4_bin PRIMARY KEY, event VARCHAR(255) NOT NULL, attempts INTEGER NOT NULL, created_at VARCHAR(32) NOT NULL, last_seen_at VARCHAR(32) NOT NULL)',
        '00002_queues_down.sql': 'DROP TABLE job_queue',
      })

      const store = await MySqlStore.open({ url: url!, migrations: folder })

      expect(await store.migrations.status()).toEqual({ applied: ['00001_thing', '00002_queues'], pending: [] })
      await store.close()
    })

    test('refuse a database whose last migration is not in the folder', async () => {
      await empty()
      const folder = await migrations()
      await (await MySqlStore.open({ url: url!, migrations: folder })).close()
      await rm(join(folder, '00001_thing_up.sql'))
      await rm(join(folder, '00001_thing_down.sql'))

      await expect(MySqlStore.open({ url: url!, migrations: folder })).rejects.toThrow('is not in the migrations folder')
    })

    test('close the store when one fails as it opens', async () => {
      await empty()
      const folder = await migrations({ '00002_broken_up.sql': 'CREATE TABLE', '00002_broken_down.sql': '' })
      const close = spyOn(MySqlStore.prototype, 'close')
      try {
        await expect(MySqlStore.open({ url: url!, migrations: folder })).rejects.toThrow()
        expect(close).toHaveBeenCalledTimes(1)
      } finally {
        close.mockRestore()
      }
    })
  })
} else {
  test.skip('MySqlStore: set FRAMEWORK_TEST_MYSQL_URL to run its tests', () => {})
}
