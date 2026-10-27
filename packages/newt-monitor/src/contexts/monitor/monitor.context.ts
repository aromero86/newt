import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import type { ServeOptions } from 'newt/http'
import { BoundedContext } from 'newt/runtime'
import type { MonitorConfig } from '../../config'
import { MonitorBase } from '../../monitor-base'
import { initializeModules, type Monitor_Modules } from './initialize-modules'

/**
 * The monitor's one context: the applications it watches, and what it learns of each.
 * Its own SQLite database; it never opens theirs.
 */
export class Monitor_Context extends BoundedContext<MonitorBase> {

  private constructor(base: MonitorBase, readonly modules: Monitor_Modules, private readonly config: MonitorConfig) {
    super('monitor', base)
  }

  static async open(config: MonitorConfig, clock?: Clock): Promise<Monitor_Context> {
    if (config.database !== ':memory:') await mkdir(dirname(config.database), { recursive: true })
    const store = await SqliteStore.open({ path: config.database })
    const base = new MonitorBase({ name: 'monitor', store, clock })
    return new Monitor_Context(base, initializeModules(base), config)
  }

  /** How it is served (`runContexts`): its modules' API under `/api`, and `GET /api/health` for whoever watches it is up. */
  serving(): ServeOptions {
    return { port: this.config.port, router: this.base.http, health: true }
  }
}
