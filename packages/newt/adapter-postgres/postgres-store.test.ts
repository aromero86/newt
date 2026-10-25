import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { SQL } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConcurrencyConflict } from '../core'
import { describeStoreContract } from '../testing'
import { PostgresStore } from './postgres-store'

/**
 * A Postgres to test against, when there is one: `FRAMEWORK_TEST_POSTGRES_URL`. Without
 * it, these tests are skipped. Its `public` schema is dropped and made again for every
 * test: a database of its own, never one that matters.
 */
const url = process.env.FRAMEWORK_TEST_POSTGRES_URL

const THING = `
CREATE TABLE thing (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, archived BOOLEAN NOT NULL, rank DOUBLE PRECISION NOT NULL,
  note TEXT, tags JSONB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL
);
CREATE UNIQUE INDEX thing_name ON thing (name) WHERE deleted_at IS NULL`

const folders: string[] = []
afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true })
})

/** A fresh, empty database: its schema dropped. */
async function empty(): Promise<void> {
  const admin = new SQL(url!)
  await admin.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await admin.close()
}

/** A folder of migrations: the thing table, and whatever else is given. */
async function migrations(more: Record<string, string> = {}): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'framework-postgres-'))
  folders.push(folder)
  await Bun.write(join(folder, '00001_thing_up.sql'), THING)
  await Bun.write(join(folder, '00001_thing_down.sql'), 'DROP TABLE thing')
  for (const [file, sql] of Object.entries(more)) await Bun.write(join(folder, file), sql)
  return folder
}

/** A fresh, empty database for each test, migrated. */
async function open(options: { waitTimeoutMs?: number } = {}): Promise<PostgresStore> {
  await empty()
  return PostgresStore.open({ url: url!, migrations: await migrations(), connections: 5, ...options })
}

if (url) {
  describeStoreContract('PostgresStore', { open })

  describe('PostgresStore', () => {
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

    test('a deadlock the database gives up is a ConcurrencyConflict', async () => {
      const store = await open()
      try {
        await store.query("INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, NULL, '[]', '', '', NULL, 1), ('b', 'w', 'b', false, 0, NULL, '[]', '', '', NULL, 1)")
        const cross = (first: string, second: string) => store.transaction(async () => {
          await store.query('UPDATE thing SET rank = rank + 1 WHERE id = $1', [first])
          await Bun.sleep(100)
          await store.query('UPDATE thing SET rank = rank + 1 WHERE id = $1', [second])
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
      const store = await open({ waitTimeoutMs: 100 })
      try {
        const holding = store.transaction(async () => {
          await store.guard(['k'])
          await Bun.sleep(500)
        })
        await Bun.sleep(20)

        await expect(store.transaction(() => store.guard(['k']))).rejects.toThrow()
        await holding
      } finally {
        await store.close()
      }
    })
  })

  describe('PostgresStore migrations', () => {
    test('apply a batch all or none', async () => {
      await empty()
      const folder = await migrations({
        '00002_extra_up.sql': 'CREATE TABLE extra (id TEXT)',
        '00002_extra_down.sql': 'DROP TABLE extra',
        '00003_broken_up.sql': 'CREATE TABLE',
        '00003_broken_down.sql': '',
      })
      const store = await PostgresStore.connect({ url: url!, migrations: folder })
      try {
        await expect(store.migrations.up()).rejects.toThrow()

        expect(await store.migrations.status()).toEqual({ applied: [], pending: ['00001_thing', '00002_extra', '00003_broken'] })
        expect(await store.query("SELECT to_regclass('extra') AS found")).toEqual([{ found: null }])
      } finally {
        await store.close()
      }
    })

    test('apply its own first, then the framework\'s: its own may have made the job tables', async () => {
      await empty()
      const folder = await migrations({
        '00002_queues_up.sql': 'CREATE TABLE job_queue (name TEXT PRIMARY KEY, event TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)',
        '00002_queues_down.sql': 'DROP TABLE job_queue',
      })

      const store = await PostgresStore.open({ url: url!, migrations: folder })

      expect(await store.migrations.status()).toEqual({ applied: ['00001_thing', '00002_queues'], pending: [] })
      await store.close()
    })

    test('refuse a database whose last migration is not in the folder', async () => {
      await empty()
      const folder = await migrations()
      await (await PostgresStore.open({ url: url!, migrations: folder })).close()
      await rm(join(folder, '00001_thing_up.sql'))
      await rm(join(folder, '00001_thing_down.sql'))

      await expect(PostgresStore.open({ url: url!, migrations: folder })).rejects.toThrow('is not in the migrations folder')
    })

    test('close the store when one fails as it opens', async () => {
      await empty()
      const folder = await migrations({ '00002_broken_up.sql': 'CREATE TABLE', '00002_broken_down.sql': '' })
      const close = spyOn(PostgresStore.prototype, 'close')
      try {
        await expect(PostgresStore.open({ url: url!, migrations: folder })).rejects.toThrow()
        expect(close).toHaveBeenCalledTimes(1)
      } finally {
        close.mockRestore()
      }
    })
  })
} else {
  test.skip('PostgresStore: set FRAMEWORK_TEST_POSTGRES_URL to run its tests', () => {})
}
