import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { SecretToken } from 'newt/core'
import { readConfig } from './config'
import { TEST_ADMIN, TEST_SECRET } from './testing/open-test-monitor'
import { Monitor_Context } from './contexts/monitor/monitor.context'
import { Auth_Context } from './contexts/auth/auth.context'

let folder: string | undefined

afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
})

test('keeps the sessions of a monitor that kept them in its one database: nobody signs in again', async () => {
  folder = await mkdtemp(join(tmpdir(), 'monitor-auth-'))
  const config = readConfig({
    NEWT_MONITOR_DATA: join(folder, 'newt-monitor.db'),
    NEWT_MONITOR_USER: TEST_ADMIN.user,
    NEWT_MONITOR_PASSWORD: TEST_ADMIN.password,
    NEWT_MONITOR_SECRET: TEST_SECRET.padEnd(32, '.'),
  })
  // The monitor before auth was a context, its migrations up to 13: its session table, with one session open.
  const before = join(folder, 'migrations')
  await cp(join(import.meta.dir, 'contexts/monitor/migrations/sqlite'), before, { recursive: true, filter: path => !path.includes('00014_') })
  await (await SqliteStore.open({ path: config.database, migrations: before })).close()
  const token = SecretToken.generate()
  const old = new Database(config.database)
  old.run('INSERT INTO session VALUES (?, ?, ?, ?, ?, 1)', ['0190a0a0-0000-7000-8000-000000000001', SecretToken.hash(token), new Date(Date.now() + 3_600_000).toISOString(), new Date().toISOString(), new Date().toISOString()])
  old.close()

  const auth = await Auth_Context.open(config)
  const monitor = await Monitor_Context.open(config, { auth: auth.modules })
  try {
    expect(await auth.modules.session.authenticate(token)).toMatchObject({ userId: TEST_ADMIN.user })
    const after = new Database(config.database, { readonly: true })
    expect(after.query(`SELECT name FROM sqlite_master WHERE name = 'session'`).get()).toBeNull()
    after.close()
  } finally {
    await monitor.stop()
    await auth.stop()
  }
})
