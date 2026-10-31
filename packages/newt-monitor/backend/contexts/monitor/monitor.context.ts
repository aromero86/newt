import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import type { ServeOptions } from 'newt/http'
import { BoundedContext } from 'newt/runtime'
import type { MonitorConfig } from '../../config'
import { MonitorBase } from '../../monitor-base'
import { MetricsStore } from '../../shared/metrics-store/metrics-store'
import { initializeModules, type Monitor_ModuleDeps, type Monitor_Modules } from './initialize-modules'

/**
 * The applications the monitor watches, and what it learns of each. Its own SQLite
 * database; it never opens theirs. Who may see them, `auth` says.
 */
export class Monitor_Context extends BoundedContext<MonitorBase> {

  private constructor(
    base: MonitorBase,
    readonly modules: Monitor_Modules,
    private readonly config: MonitorConfig,
    private readonly metrics: MetricsStore,
  ) {
    super('monitor', base)
  }

  /** Opened after `auth`, which it uses; on the real time, unless a test gives it a `clock`. */
  static async open(config: MonitorConfig, deps: Monitor_ModuleDeps, clock?: Clock): Promise<Monitor_Context> {
    if (config.database !== ':memory:') await mkdir(dirname(config.database), { recursive: true })
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations/sqlite') })
    const base = new MonitorBase({ name: 'monitor', store, clock })
    const metrics = new MetricsStore(config.metricsFolder)
    return new Monitor_Context(base, initializeModules(base, config, metrics, deps), config, metrics)
  }

  /** Its jobs end and its store closes, then every application's DuckDB: none is left open, with a query on its way, as the process ends. */
  override async stop(): Promise<void> {
    await super.stop()
    await this.metrics.close()
  }

  /**
   * How it is served (`runContexts`): its modules' API under `/api`, `GET /api/health`
   * for whoever watches it is up, and its built frontend for any other address.
   */
  serving(): ServeOptions {
    return { port: this.config.port, router: this.base.http, health: true, frontend: this.config.frontend }
  }
}
