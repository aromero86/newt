import { afterAll, beforeAll } from 'bun:test'
import { SQL } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileStore } from '../adapter-files'
import { MySqlStore } from '../adapter-mysql'
import { PostgresStore } from '../adapter-postgres'
import { SqliteStore } from '../adapter-sqlite'
import type { Store } from '../port-store'
import { describeRateLimitContract } from './contract'
import type { RateLimitRow } from './rate-limit-row'
import { TableRateLimitStore } from './table-rate-limit-store'

// The rate limit table on every store: SQLite and files always, Postgres and MySQL when
// there is one to test against (FRAMEWORK_TEST_POSTGRES_URL, FRAMEWORK_TEST_MYSQL_URL),
// dropped and made again for every test, as their own suites do.
const postgres = process.env.FRAMEWORK_TEST_POSTGRES_URL
const mysql = process.env.FRAMEWORK_TEST_MYSQL_URL

const TABLE = {
  sqlite: 'CREATE TABLE rate_limit (id TEXT PRIMARY KEY, version INTEGER NOT NULL, start TEXT NOT NULL, count INTEGER NOT NULL, previous INTEGER NOT NULL, expires_at TEXT NOT NULL); CREATE INDEX rate_limit_expires_at ON rate_limit (expires_at);',
  postgres: 'CREATE TABLE rate_limit (id TEXT COLLATE "C" PRIMARY KEY, version INTEGER NOT NULL, start TEXT COLLATE "C" NOT NULL, count INTEGER NOT NULL, previous INTEGER NOT NULL, expires_at TEXT COLLATE "C" NOT NULL); CREATE INDEX rate_limit_expires_at ON rate_limit (expires_at);',
  mysql: 'CREATE TABLE rate_limit (id VARCHAR(64) COLLATE utf8mb4_0900_bin PRIMARY KEY, version INTEGER NOT NULL, start VARCHAR(32) NOT NULL, count INTEGER NOT NULL, previous INTEGER NOT NULL, expires_at VARCHAR(32) NOT NULL, INDEX rate_limit_expires_at (expires_at));',
}

const folders: Record<string, string> = {}
const opened: Store[] = []

beforeAll(async () => {
  for (const [dialect, sql] of Object.entries(TABLE)) {
    const folder = await mkdtemp(join(tmpdir(), `newt-rate-limit-${dialect}-`))
    await Bun.write(join(folder, '00001_rate_limit_up.sql'), sql)
    await Bun.write(join(folder, '00001_rate_limit_down.sql'), 'DROP TABLE rate_limit;')
    folders[dialect] = folder
  }
})

afterAll(async () => {
  for (const folder of Object.values(folders)) await rm(folder, { recursive: true, force: true })
})

const on = (store: Store) => {
  opened.push(store)
  return new TableRateLimitStore(store.table<RateLimitRow>('rate_limit'))
}
const close = async () => {
  for (const store of opened.splice(0)) await store.close()
}

describeRateLimitContract('TableRateLimitStore on SqliteStore', {
  open: async () => on(await SqliteStore.open({ path: ':memory:', migrations: folders.sqlite })),
  close,
})

describeRateLimitContract('TableRateLimitStore on FileStore', {
  open: async () => {
    const folder = await mkdtemp(join(tmpdir(), 'newt-rate-limit-files-'))
    folders[folder] = folder
    return on(await FileStore.open({ folder }))
  },
  close,
})

if (postgres) {
  describeRateLimitContract('TableRateLimitStore on PostgresStore', {
    open: async () => {
      const admin = new SQL(postgres)
      await admin.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
      await admin.close()
      return on(await PostgresStore.open({ url: postgres, migrations: folders.postgres, connections: 5 }))
    },
    close,
  })
}

if (mysql) {
  const database = new URL(mysql).pathname.slice(1)
  const server = Object.assign(new URL(mysql), { pathname: '/' }).href
  describeRateLimitContract('TableRateLimitStore on MySqlStore', {
    open: async () => {
      const admin = new SQL(server)
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`)
      await admin.unsafe(`CREATE DATABASE ${database}`)
      await admin.close()
      return on(await MySqlStore.open({ url: mysql, migrations: folders.mysql, connections: 5 }))
    },
    close,
  })
}
