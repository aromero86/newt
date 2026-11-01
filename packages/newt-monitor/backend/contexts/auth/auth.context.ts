import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SqliteStore } from '@newt-kit/newt/adapter-sqlite'
import type { Clock } from '@newt-kit/newt/core'
import { BoundedContext } from '@newt-kit/newt/runtime'
import type { MonitorConfig } from '../../config'
import { AuthBase } from './auth-base'
import { initializeModules, type Auth_Modules } from './initialize-modules'
import { moveSessions } from './sessions-moved'

/**
 * Started with another user or password (one that leaked, changed), nothing the old
 * ones opened goes on: every MCP client's tokens are revoked, then every session ends.
 * In that order, so a start that stops halfway does it all again the next time.
 */
async function endWhatOtherCredentialsOpened(modules: Auth_Modules): Promise<void> {
  if (!(await modules.session.credentialsChanged())) return
  await modules.token.revokeAll()
  await modules.session.endAll()
}

/**
 * Who may enter the monitor: the one person its settings name, their sessions, and the
 * MCP clients they let in through OAuth. Its own SQLite database. Opened before
 * `monitor`, which asks it who each request is; its routes are served on the monitor's port.
 */
export class Auth_Context extends BoundedContext<AuthBase> {

  private constructor(base: AuthBase, readonly modules: Auth_Modules) {
    super('auth', base)
  }

  static async open(config: MonitorConfig, clock?: Clock): Promise<Auth_Context> {
    if (config.authDatabase !== ':memory:') await mkdir(dirname(config.authDatabase), { recursive: true })
    const store = await SqliteStore.open({ path: config.authDatabase, migrations: join(import.meta.dir, 'migrations/sqlite') })
    moveSessions(config.database, config.authDatabase)
    const base = new AuthBase({ name: 'auth', store, clock })
    const modules = initializeModules(base, config)
    await endWhatOtherCredentialsOpened(modules)
    return new Auth_Context(base, modules)
  }

  /** Its routes (`/api/session`, `/api/authorizations`) and OAuth's, for the monitor's server to serve beside its own. */
  routes(): Bun.Serve.Routes<undefined, string> {
    return { ...this.base.http.routes(), ...this.base.oauth.routes() }
  }
}
