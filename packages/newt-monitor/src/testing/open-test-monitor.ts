import { runContexts } from 'newt/application'
import type { Clock } from 'newt/core'
import { browser } from 'newt/testing'
import type { MonitorConfig } from '../config'
import { Monitor_Context } from '../contexts/monitor/monitor.context'

/** Who signs in to a test's monitor. */
export const TEST_ADMIN = { user: 'ana', password: 'a password only tests know' }

/** A test's settings: its database in memory, on a free port. */
const TEST_CONFIG: MonitorConfig = {
  port: 0,
  database: ':memory:',
  publicUrl: 'http://localhost:4800',
  admin: TEST_ADMIN,
  sessionHours: 12,
  secret: 'a secret only tests encrypt with',
}

/** What a test changes of the monitor's settings (everything else is a test's), and the clock it tells the time by. */
export type TestMonitorOptions = Partial<MonitorConfig> & { clock?: Clock }

/** The monitor for a test, served on a free port, stopped by `close`. */
export async function openTestMonitor({ clock, ...options }: TestMonitorOptions = {}) {
  const monitor = await Monitor_Context.open({ ...TEST_CONFIG, ...options }, clock)
  const app = runContexts([{ context: monitor, serve: monitor.serving() }], { signals: false })
  const url = app.servers.monitor!.url.origin
  return {
    monitor,
    modules: monitor.modules,
    url,
    /** A request to its API, by path (`/api/health`), with no session. */
    fetch: (path: string, init?: RequestInit) => fetch(`${url}${path}`, init),
    /** A browser signed in as the test's admin: it keeps the session's cookie. */
    async signedIn() {
      const as = browser(url)
      const response = await as('/api/session', { method: 'POST', json: TEST_ADMIN })
      if (!response.ok) throw new Error(`signing in answered ${response.status}`)
      return as
    },
    close: () => app.stop(),
  }
}

export type TestMonitor = Awaited<ReturnType<typeof openTestMonitor>>
