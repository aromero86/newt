import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConcurrencyConflict } from '../core'
import { describeStoreContract, type ThingRow } from '../port-store/contract'
import { SqliteStore } from './sqlite-store'

const THING = `CREATE TABLE thing (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, archived INTEGER NOT NULL, rank REAL NOT NULL,
  note TEXT, tags TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL
);
CREATE UNIQUE INDEX thing_name ON thing (name) WHERE deleted_at IS NULL`

const folders: string[] = []

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

/** A store on a file: the only kind with a second connection, to read outside transactions. */
async function open(): Promise<SqliteStore> {
  const folder = await mkdtemp(join(tmpdir(), 'framework-sqlite-'))
  folders.push(folder)
  await Bun.write(join(folder, 'migrations/00001_thing_up.sql'), THING)
  await Bun.write(join(folder, 'migrations/00001_thing_down.sql'), 'DROP TABLE thing')
  return SqliteStore.open({ path: join(folder, 'test.db'), migrations: join(folder, 'migrations') })
}

describeStoreContract('SqliteStore', { open })

describeStoreContract('SqliteStore in memory', {
  open: async () => {
    const store = await SqliteStore.open({ path: ':memory:' })
    await store.transaction(() => { for (const statement of THING.split(';')) store.connection.run(statement) })
    return store
  },
})

describe('SqliteStore', () => {
  test('refuses a write outside a transaction on its connection, however it is written', async () => {
    const store = await open()
    try {
      expect(() => store.connection.prepare("INSERT INTO thing (id) VALUES ('x')").run()).toThrow('store.transaction')
      expect(() => store.connection.run('WITH gone AS (SELECT id FROM thing) DELETE FROM thing WHERE id IN gone')).toThrow('store.transaction')
      expect(() => store.connection.run('/* sneaky */ DELETE FROM thing')).toThrow()
    } finally {
      await store.close()
    }
  })

  test('reads with common table expressions outside a transaction', async () => {
    const store = await open()
    try {
      expect(store.connection.prepare('WITH some AS (SELECT id FROM thing) SELECT count(*) AS total FROM some').get()).toEqual({ total: 0 })
    } finally {
      await store.close()
    }
  })

  test('runs a statement on the right connection when it runs, not when it was prepared', async () => {
    const store = await open()
    try {
      const count = store.connection.prepare('SELECT count(*) AS total FROM thing')
      await store.transaction(async () => {
        await store.table<ThingRow>('thing', { types: { archived: 'boolean', tags: 'json' } }).insert({ id: 't1', workspaceId: 'w', name: 'a', archived: false, rank: 0, note: null, tags: [], createdAt: '', updatedAt: '', deletedAt: null })
        expect(count.get()).toEqual({ total: 1 })
      })
      expect(store.connection.serialize()).toBeInstanceOf(Uint8Array)
    } finally {
      await store.close()
    }
  })

  test('works in memory, for tests', async () => {
    const store = await SqliteStore.open({ path: ':memory:' })
    try {
      await store.transaction(() => store.connection.run('CREATE TABLE note (id TEXT PRIMARY KEY, version INTEGER NOT NULL)'))
      await store.table('note').insert({ id: 'n1' })
      expect(await store.table('note').find()).toEqual([{ id: 'n1', version: 1 }])
    } finally {
      await store.close()
    }
  })

  test('migrates the outbox after its own migrations', async () => {
    const store = await open()
    try {
      expect(await store.migrations.status()).toEqual({ applied: ['00001_thing'], pending: [] })
      expect(await store.outbox.list()).toEqual([])
    } finally {
      await store.close()
    }
  })
})

describe('SqliteStore, further', () => {
  test('a collision raised by its own SQL inside a transaction is a ConcurrencyConflict', async () => {
    const store = await open()
    try {
      const add = () => store.connection.run("INSERT INTO thing (id, workspace_id, name, archived, rank, tags, created_at, updated_at, version) VALUES ('t1', 'w', 'a', 0, 0, '[]', '', '', 1)")
      await store.transaction(add)

      await expect(store.transaction(add)).rejects.toThrow(ConcurrencyConflict)
    } finally {
      await store.close()
    }
  })

  test('refuses transactions of the connection: they would not be the store\'s', async () => {
    const store = await open()
    try {
      expect(() => store.connection.transaction(() => {})).toThrow('store.transaction')
    } finally {
      await store.close()
    }
  })

  test('turns foreign keys on', async () => {
    const store = await open()
    try {
      expect(await store.transaction(() => store.connection.prepare('PRAGMA foreign_keys').get())).toEqual({ foreign_keys: 1 })
    } finally {
      await store.close()
    }
  })

  test('closing waits for the transactions in progress', async () => {
    const store = await open()
    const log: string[] = []

    const running = store.transaction(async () => {
      await Bun.sleep(10)
      log.push('transaction ended')
    })
    await Bun.sleep(1)
    await store.close()
    log.push('closed')
    await running

    expect(log).toEqual(['transaction ended', 'closed'])
  })

  test('in memory, it leaves no file behind once closed', async () => {
    const mine = async () => (await readdir(tmpdir())).filter(name => name.startsWith('framework-sqlite-') && name.includes('.db'))
    const before = await mine()

    const store = await SqliteStore.open({ path: ':memory:' })
    expect((await mine()).length).toBeGreaterThan(before.length)
    await store.close()

    expect(await mine()).toEqual(before)
  })

  test('closes itself when a migration fails as it opens', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'framework-sqlite-'))
    folders.push(folder)
    await Bun.write(join(folder, 'migrations/00001_broken_up.sql'), 'CREATE TABLE')
    await Bun.write(join(folder, 'migrations/00001_broken_down.sql'), '')
    const close = spyOn(SqliteStore.prototype, 'close')

    try {
      await expect(SqliteStore.open({ path: join(folder, 'test.db'), migrations: join(folder, 'migrations') })).rejects.toThrow()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      close.mockRestore()
    }
  })

  test('migrates its own first, then the framework\'s: its own may have made the job tables', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'framework-sqlite-'))
    folders.push(folder)
    await Bun.write(join(folder, 'migrations/00001_queues_up.sql'), 'CREATE TABLE job_queue (name TEXT PRIMARY KEY, event TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)')
    await Bun.write(join(folder, 'migrations/00001_queues_down.sql'), 'DROP TABLE job_queue')

    const store = await SqliteStore.open({ path: join(folder, 'test.db'), migrations: join(folder, 'migrations') })
    await store.close()
  })

  test('a migration waits for the transactions in progress', async () => {
    const store = await open()
    const log: string[] = []
    try {
      const folder = folders.at(-1)!
      await Bun.write(join(folder, 'migrations/00002_extra_up.sql'), 'CREATE TABLE extra (id TEXT)')
      await Bun.write(join(folder, 'migrations/00002_extra_down.sql'), 'DROP TABLE extra')

      const running = store.transaction(async () => {
        await Bun.sleep(10)
        log.push('transaction ended')
      })
      await Bun.sleep(1)
      await store.migrations.up()
      log.push('migrated')
      await running

      expect(log).toEqual(['transaction ended', 'migrated'])
    } finally {
      await store.close()
    }
  })
})
