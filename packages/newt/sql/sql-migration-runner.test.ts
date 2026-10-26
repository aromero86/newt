import { afterAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MySqlStore } from '../adapter-mysql'
import { PostgresStore } from '../adapter-postgres'

/**
 * The migrations of the stores on a database server, against the servers there are:
 * `FRAMEWORK_TEST_POSTGRES_URL`, `FRAMEWORK_TEST_MYSQL_URL`. Without them, these tests
 * are skipped. Their databases are emptied for every test: databases of their own.
 */
const postgres = process.env.FRAMEWORK_TEST_POSTGRES_URL
const mysql = process.env.FRAMEWORK_TEST_MYSQL_URL

const folders: string[] = []
afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true })
})

/** A folder of migrations, with these files. */
async function migrations(files: Record<string, string>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'framework-sql-migrations-'))
  folders.push(folder)
  for (const [file, sql] of Object.entries(files)) await Bun.write(join(folder, file), sql)
  return folder
}

const COUNTER = { '00001_counter_up.sql': 'CREATE TABLE counter (n INTEGER NOT NULL)', '00001_counter_down.sql': 'DROP TABLE counter' }
const SEED = { '00002_seed_up.sql': 'INSERT INTO counter VALUES (1)', '00002_seed_down.sql': 'DELETE FROM counter' }

type Server = { name: string, url: string | undefined, empty: () => Promise<void>, open: (folder: string) => Promise<PostgresStore | MySqlStore> }

const servers: Server[] = [
  {
    name: 'Postgres',
    url: postgres,
    empty: async () => {
      const admin = new SQL(postgres!)
      await admin.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
      await admin.close()
    },
    open: folder => PostgresStore.open({ url: postgres!, migrations: folder }),
  },
  {
    name: 'MySQL',
    url: mysql,
    empty: async () => {
      const database = new URL(mysql!).pathname.slice(1)
      const admin = new SQL(Object.assign(new URL(mysql!), { pathname: '/' }).href)
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`)
      await admin.unsafe(`CREATE DATABASE ${database}`)
      await admin.close()
    },
    open: folder => MySqlStore.open({ url: mysql!, migrations: folder }),
  },
]

for (const server of servers) {
  describe.skipIf(!server.url)(`SqlMigrationRunner on ${server.name}`, () => {
    test('two processes migrating at once take turns: both open, each migration applied once', async () => {
      await server.empty()
      const folder = await migrations({ ...COUNTER, ...SEED })

      const stores = await Promise.all([server.open(folder), server.open(folder)])
      try {
        const [row] = await stores[0].query('SELECT count(*) AS n FROM counter')
        expect(Number(row!.n)).toBe(1)
        expect(await stores[1].migrations.status()).toEqual({ applied: ['00001_counter', '00002_seed'], pending: [], changed: [] })
      } finally {
        for (const store of stores) await store.close()
      }
    })

    test('a migration with no change of structure that fails halfway keeps nothing', async () => {
      await server.empty()
      const folder = await migrations(COUNTER)
      await (await server.open(folder)).close()
      await Bun.write(join(folder, '00002_seed_up.sql'), 'INSERT INTO counter VALUES (1);\nINSERT INTO missing VALUES (1)')
      await Bun.write(join(folder, '00002_seed_down.sql'), 'DELETE FROM counter')

      await expect(server.open(folder)).rejects.toThrow()

      const store = await (server.name === 'MySQL' ? MySqlStore : PostgresStore).connect({ url: server.url!, migrations: folder })
      try {
        expect(await store.migrations.status()).toEqual({ applied: ['00001_counter'], pending: ['00002_seed'], changed: [] })
        const [row] = await store.query('SELECT count(*) AS n FROM counter')
        expect(Number(row!.n)).toBe(0)
      } finally {
        await store.close()
      }
    })

    test('refuse two migrations with the same number, naming both', async () => {
      await server.empty()
      const folder = await migrations({
        ...COUNTER,
        '00002_orders_up.sql': 'CREATE TABLE orders (id INTEGER)', '00002_orders_down.sql': 'DROP TABLE orders',
        '00002_users_up.sql': 'CREATE TABLE users (id INTEGER)', '00002_users_down.sql': 'DROP TABLE users',
      })

      await expect(server.open(folder)).rejects.toThrow('Migrations 00002_orders and 00002_users have the same number')
    })

    test('refuse to go on when a migration applied was changed since, naming it', async () => {
      await server.empty()
      const folder = await migrations(COUNTER)
      await (await server.open(folder)).close()
      await Bun.write(join(folder, '00001_counter_up.sql'), 'CREATE TABLE counter (n INTEGER)')

      await expect(server.open(folder)).rejects.toThrow('Migration 00001_counter was changed after it was applied')
    })

    test('tell in status which applied migration was changed since', async () => {
      await server.empty()
      const folder = await migrations({ ...COUNTER, ...SEED })
      await (await server.open(folder)).close()
      await Bun.write(join(folder, '00001_counter_up.sql'), 'CREATE TABLE counter (n INTEGER)')

      const store = await (server.name === 'Postgres' ? PostgresStore : MySqlStore).connect({ url: server.url!, migrations: folder })
      try {
        expect(await store.migrations.status()).toEqual({ applied: ['00001_counter', '00002_seed'], pending: [], changed: ['00001_counter'] })
      } finally {
        await store.close()
      }
    })

    test('a database from before checksums were kept takes its migrations as they are, and keeps theirs from then on', async () => {
      await server.empty()
      const folder = await migrations(COUNTER)
      const admin = new SQL(server.url!)
      await admin.unsafe('CREATE TABLE migrations (version INTEGER PRIMARY KEY, name VARCHAR(255) NOT NULL)')
      await admin.unsafe('CREATE TABLE counter (n INTEGER NOT NULL)')
      await admin.unsafe("INSERT INTO migrations (version, name) VALUES (1, 'counter')")
      await admin.close()

      const store = await server.open(folder)
      try {
        expect(await store.query('SELECT checksum FROM migrations')).toEqual([{ checksum: expect.stringMatching(/^[0-9a-f]{64}$/) }])
      } finally {
        await store.close()
      }
      await Bun.write(join(folder, '00001_counter_up.sql'), 'CREATE TABLE counter (n INTEGER)')
      await expect(server.open(folder)).rejects.toThrow('was changed after it was applied')
    })
  })
}
