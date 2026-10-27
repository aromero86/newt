import { runContexts } from 'newt/application'
import type { MonitorConfig } from '../config'
import { Monitor_Context } from '../contexts/monitor/monitor.context'

/** What a test changes of the monitor's settings: everything else is a test's. */
export type TestMonitorOptions = Partial<MonitorConfig>

/** The monitor for a test: its database in memory, served on a free port, stopped by `close`. */
export async function openTestMonitor(options: TestMonitorOptions = {}) {
  const monitor = await Monitor_Context.open({ port: 0, database: ':memory:', ...options })
  const app = runContexts([{ context: monitor, serve: monitor.serving() }], { signals: false })
  const url = app.servers.monitor!.url.origin
  return {
    monitor,
    modules: monitor.modules,
    url,
    /** A request to its API, by path (`/api/health`). */
    fetch: (path: string, init?: RequestInit) => fetch(`${url}${path}`, init),
    close: () => app.stop(),
  }
}

export type TestMonitor = Awaited<ReturnType<typeof openTestMonitor>>
