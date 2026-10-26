import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { SQL } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConcurrencyConflict, ValidationError } from '../core'
import { describeStoreContract } from '../port-store/contract'
import { PostgresStore } from './postgres-store'

/**
 * A Postgres to test against, when there is one: `FRAMEWORK_TEST_POSTGRES_URL`. Without
 * it, these tests are skipped. Its `public` schema is dropped and made again for every
 * test: a database of its own, never one that matters.
 */
const url = process.env.FRAMEWORK_TEST_POSTGRES_URL

const THING = `
CREATE TABLE thing (
  id TEXT COLLATE "C" PRIMARY KEY, workspace_id TEXT COLLATE "C" NOT NULL, name TEXT COLLATE "C" NOT NULL, archived BOOLEAN NOT NULL, rank DOUBLE PRECISION NOT NULL,
  note TEXT COLLATE "C", tags JSONB NOT NULL, created_at TEXT COLLATE "C" NOT NULL, updated_at TEXT COLLATE "C" NOT NULL, deleted_at TEXT COLLATE "C", version INTEGER NOT NULL
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

        await expect(store.transaction(() => store.guard(['k']))).rejects.toThrow("the guard 'k'")
        await holding
      } finally {
        await store.close()
      }
    })

    test('guards a key with NUL, which its text cannot hold, as a key of its own', async () => {
      const store = await open({ waitTimeoutMs: 100 })
      try {
        const holding = store.transaction(async () => {
          await store.guard(['name:a\u0000b'])
          await Bun.sleep(500)
        })
        await Bun.sleep(20)

        await store.transaction(() => store.guard(['name:a\\0b']))
        await expect(store.transaction(() => store.guard(['name:a\u0000b']))).rejects.toThrow('the guard')
        await holding
      } finally {
        await store.close()
      }
    })

    test('a guard bounds its own wait only: a row lock after it waits as long as it takes', async () => {
      const store = await open({ waitTimeoutMs: 100 })
      try {
        await store.query("INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, NULL, '[]', '', '', NULL, 1)")
        const holding = store.transaction(async () => {
          await store.query('UPDATE thing SET rank = 1 WHERE id = $1', ['a'])
          await Bun.sleep(300)
        })
        await Bun.sleep(20)

        await store.transaction(async () => {
          await store.guard(['unrelated'])
          await store.query('UPDATE thing SET rank = 2 WHERE id = $1', ['a'])
        })
        await holding
        expect(await store.query('SELECT rank FROM thing')).toEqual([{ rank: 2 }])
      } finally {
        await store.close()
      }
    })

    test('a transaction a failed statement spoiled is not committed: it fails', async () => {
      const store = await open()
      try {
        const things = store.table<{ id: string, version: number, name: string }>('thing')

        await expect(store.transaction(async () => {
          await store.query("INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, NULL, '[]', '', '', NULL, 1)")
          await store.query('SELECT 1/0').catch(() => {})
        })).rejects.toThrow('rolled back, not committed')
        expect(await things.count()).toBe(0)
      } finally {
        await store.close()
      }
    })

    test('refuses text with NUL as a ValidationError, and the transaction goes on', async () => {
      const store = await open()
      try {
        const things = store.table<{ id: string, version: number, name: string, note: string | null }>('thing')
        await store.query("INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, NULL, '[]', '', '', NULL, 1)")

        await store.transaction(async () => {
          await expect(things.patch('a', { note: 'x\u0000y' })).rejects.toBeInstanceOf(ValidationError)
          await things.patch('a', { note: 'kept' })
        })

        expect(await store.query('SELECT note FROM thing')).toEqual([{ note: 'kept' }])
        expect(await things.find({ id: 'a\u0000' })).toEqual([])
        await expect(things.update('a\u0000', 1, { note: 'x' })).rejects.toBeInstanceOf(ConcurrencyConflict)
        await expect(things.delete('a\u0000', 1)).rejects.toBeInstanceOf(ConcurrencyConflict)
        await things.patch('a\u0000', { note: 'x' })
      } finally {
        await store.close()
      }
    })

    test('hands a BIGINT back as a number while it is exact, and a NUMERIC as text', async () => {
      const store = await open()
      try {
        await store.query('CREATE TABLE amount (id TEXT PRIMARY KEY, version INTEGER NOT NULL, big BIGINT, exact NUMERIC(10, 2))')
        const amounts = store.table<{ id: string, version: number, big: number | string, exact: string }>('amount')
        await amounts.insert({ id: 'a', big: 5, exact: '1.5' })
        await amounts.insert({ id: 'b', big: '9007199254740993', exact: '2' })

        expect(await amounts.find()).toEqual([{ id: 'a', version: 1, big: 5, exact: '1.50' }, { id: 'b', version: 1, big: '9007199254740993', exact: '2.00' }])
      } finally {
        await store.close()
      }
    })

    test('keeps a json field as real JSON, which SQL reads as such', async () => {
      const store = await open()
      try {
        await store.query('CREATE TABLE doc (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data JSONB)')
        const docs = store.table<{ id: string, version: number, data: unknown }>('doc', { types: { data: 'json' } })
        await docs.insert({ id: 'a', data: { x: 'one', n: [1, 2] } })
        await docs.insert({ id: 'b', data: '{"x":"two"}' })
        await docs.insert({ id: 'c', data: 5 })
        await docs.update('c', 1, { data: [true] })

        expect(await store.query("SELECT id, jsonb_typeof(data) AS kind, data->>'x' AS x FROM doc ORDER BY id")).toEqual([
          { id: 'a', kind: 'object', x: 'one' },
          { id: 'b', kind: 'string', x: null },
          { id: 'c', kind: 'array', x: null },
        ])
        expect((await docs.find()).map(doc => doc.data)).toEqual([{ x: 'one', n: [1, 2] }, '{"x":"two"}', [true]])
      } finally {
        await store.close()
      }
    })

    test('learns of a column added after it first read', async () => {
      const store = await open()
      try {
        await store.query('CREATE TABLE amount (id TEXT PRIMARY KEY, version INTEGER NOT NULL)')
        const amounts = store.table<{ id: string, version: number, big?: number }>('amount')
        await amounts.find()
        await store.query('ALTER TABLE amount ADD COLUMN big BIGINT')
        await amounts.insert({ id: 'a', big: 5 })

        expect(await amounts.find()).toEqual([{ id: 'a', version: 1, big: 5 }])
      } finally {
        await store.close()
      }
    })

    test('reads a json field kept in a domain over JSONB as JSONB', async () => {
      const store = await open()
      try {
        await store.query('CREATE DOMAIN doc_data AS JSONB; CREATE TABLE doc (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data doc_data)')
        const docs = store.table<{ id: string, version: number, data: unknown }>('doc', { types: { data: 'json' } })
        await docs.insert({ id: 'a', data: 'hello' })
        await docs.insert({ id: 'b', data: '123' })

        expect((await docs.find()).map(doc => doc.data)).toEqual(['hello', '123'])
      } finally {
        await store.close()
      }
    })

    test('learns its columns again once its store migrated them', async () => {
      await empty()
      const folder = await migrations({ '00002_note_up.sql': 'ALTER TABLE thing ALTER COLUMN note SET NOT NULL', '00002_note_down.sql': '' })
      const store = await PostgresStore.open({ url: url!, migrations: folder, connections: 5 })
      try {
        const things = store.table<{ id: string, version: number, note: string | null }>('thing', { columns: {} })
        await store.query("INSERT INTO thing VALUES ('a', 'w', 'a', false, 0, 'x', '[]', '', '', NULL, 1)")
        await things.find({}, { orderBy: [{ field: 'note' }] })
        await Bun.write(join(folder, '00003_note_up.sql'), 'ALTER TABLE thing ALTER COLUMN note DROP NOT NULL')
        await Bun.write(join(folder, '00003_note_down.sql'), '')
        await store.migrations.up()
        await store.query("INSERT INTO thing VALUES ('b', 'w', 'b', false, 0, NULL, '[]', '', '', NULL, 1)")

        expect((await things.find({}, { orderBy: [{ field: 'note' }] })).map(thing => thing.id)).toEqual(['b', 'a'])
      } finally {
        await store.close()
      }
    })

    test('reads a json field kept in a text column as it was written', async () => {
      const store = await open()
      try {
        await store.query('CREATE TABLE doc (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT)')
        const docs = store.table<{ id: string, version: number, data: unknown }>('doc', { types: { data: 'json' } })
        await docs.insert({ id: 'a', data: { x: 1 } })
        await docs.insert({ id: 'b', data: '{"x":"two"}' })

        expect((await docs.find()).map(doc => doc.data)).toEqual([{ x: 1 }, '{"x":"two"}'])
      } finally {
        await store.close()
      }
    })

    test('orders and pages by the primary key through its index, and a nullable column through one of the same NULLS order', async () => {
      const store = await open()
      try {
        await store.query(`INSERT INTO thing SELECT lpad(g::text, 8, '0'), 'w', 'n' || g, false, 0, CASE WHEN g % 7 = 0 THEN NULL ELSE 'n' || g END, '[]', '', '', NULL, 1 FROM generate_series(1, 20000) g`)
        await store.query('CREATE INDEX thing_note ON thing (note NULLS FIRST)')
        await store.query('ANALYZE thing')
        const things = store.table<{ id: string, version: number, note: string | null }>('thing')
        const query = spyOn(store, 'query')
        const plan = async (find: () => Promise<unknown>) => {
          query.mockClear()
          await find()
          const [sql, params] = query.mock.calls.findLast(([sql]) => sql.startsWith('SELECT * FROM'))!
          return (await store.query(`EXPLAIN ${sql}`, params)).map(row => Object.values(row)[0]).join('\n')
        }

        expect(await plan(() => things.find({}, { limit: 10 }))).toMatch(/Index (Only )?Scan using thing_pkey/)
        expect(await plan(() => things.find({ id: { gt: '00010000' } }, { limit: 10 }))).toMatch(/Index (Only )?Scan using thing_pkey/)
        expect(await plan(() => things.find({}, { orderBy: [{ field: 'id', direction: 'desc' }], limit: 10 }))).toMatch(/Index (Only )?Scan Backward using thing_pkey/)
        expect(await plan(() => things.find({}, { orderBy: [{ field: 'note' }], limit: 10 }))).toMatch(/Index Scan using thing_note/)
        expect(await plan(() => things.find({}, { orderBy: [{ field: 'note', direction: 'desc' }], limit: 10 }))).toMatch(/Index Scan Backward using thing_note/)
        query.mockRestore()
      } finally {
        await store.close()
      }
    })

    test('sorts by the collation a column was given, when it was given one', async () => {
      const store = await open()
      try {
        await store.query('CREATE TABLE word (id TEXT PRIMARY KEY, version INTEGER NOT NULL, text TEXT COLLATE "en-US-x-icu")')
        const words = store.table<{ id: string, version: number, text: string }>('word')
        for (const [id, text] of [['1', 'bea'], ['2', 'Bob'], ['3', 'Ana']]) await words.insert({ id, text })

        expect((await words.find({}, { orderBy: [{ field: 'text' }] })).map(word => word.text)).toEqual(['Ana', 'bea', 'Bob'])
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

    test('apply a function and its trigger, whose bodies have semicolons of their own', async () => {
      await empty()
      const folder = await migrations({
        '00002_stamp_up.sql': `CREATE FUNCTION stamp_name() RETURNS trigger AS $$
BEGIN
  NEW.name := upper(NEW.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER thing_stamp BEFORE INSERT ON thing FOR EACH ROW EXECUTE FUNCTION stamp_name();`,
        '00002_stamp_down.sql': 'DROP TRIGGER thing_stamp ON thing; DROP FUNCTION stamp_name();',
      })

      const store = await PostgresStore.open({ url: url!, migrations: folder })
      try {
        expect(await store.migrations.status()).toEqual({ applied: ['00001_thing', '00002_stamp'], pending: [] })
        expect(await store.migrations.down()).toBe('00002_stamp')
      } finally {
        await store.close()
      }
    })

    test('refuse a migrations folder that is not there', async () => {
      await empty()
      await expect(PostgresStore.open({ url: url!, migrations: join(tmpdir(), 'framework-postgres-missing') })).rejects.toThrow('cannot be read')
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
