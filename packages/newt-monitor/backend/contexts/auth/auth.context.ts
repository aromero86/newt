import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import { BoundedContext } from 'newt/runtime'
import type { MonitorConfig } from '../../config'
import { MonitorBase } from '../../monitor-base'
import { initializeModules, type Auth_Modules } from './initialize-modules'
import { moveSessions } from './sessions-moved'

/**
 * Who may enter the monitor: the one person its settings name, and their sessions. Its
 * own SQLite database. Opened before `monitor`, which asks it who each request is; its
 * routes are served on the monitor's port.
 */
export class Auth_Context extends BoundedContext<MonitorBase> {

  private constructor(base: MonitorBase, readonly modules: Auth_Modules) {
    super('auth', base)
  }

  static async open(config: MonitorConfig, clock?: Clock): Promise<Auth_Context> {
    if (config.authDatabase !== ':memory:') await mkdir(dirname(config.authDatabase), { recursive: true })
    const store = await SqliteStore.open({ path: config.authDatabase, migrations: join(import.meta.dir, 'migrations/sqlite') })
    moveSessions(config.database, config.authDatabase)
    const base = new MonitorBase({ name: 'auth', store, clock })
    return new Auth_Context(base, initializeModules(base, config))
  }

  /** Its routes (`/api/session`), for the monitor's server to serve beside its own. */
  routes() {
    return this.base.http.routes()
  }
}
