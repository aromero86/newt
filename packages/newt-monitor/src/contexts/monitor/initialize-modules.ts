import type { MonitorConfig } from '../../config'
import type { MonitorBase } from '../../monitor-base'
import type { AppClient } from '../../shared/app-client/app-client'
import { HttpAppClient } from '../../shared/app-client/http-app-client'
import { KeyCipher } from '../../shared/key-cipher'
import { App_Module } from './modules/app/app.module'
import { Catalog_Module } from './modules/catalog/catalog.module'
import { Connection_Module } from './modules/connection/connection.module'
import { Metrics_Module } from './modules/metrics/metrics.module'
import { MetricsStore } from './modules/metrics/services/metrics-store'
import { Session_Module } from './modules/session/session.module'
import { Structure_Module } from './modules/structure/structure.module'

/** What the modules are given from outside: the applications, over HTTP, unless a test gives another way to them. */
export type Monitor_ModuleDeps = { client?: AppClient }

/** Every module of `monitor`, each one after the modules it uses. */
export function initializeModules(base: MonitorBase, config: MonitorConfig, deps: Monitor_ModuleDeps = {}) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  const client = deps.client ?? new HttpAppClient()
  const app = App_Module.initialize(base, { client }, { cipher: new KeyCipher(config.secret) })
  const connection = Connection_Module.initialize(base, { app, client })
  const structure = Structure_Module.initialize(base, { app, connection })
  const catalog = Catalog_Module.initialize(base, { app, structure })
  const metrics = Metrics_Module.initialize(base, { app, connection }, { store: new MetricsStore(config.metricsFolder) })
  return { session, app, connection, structure, catalog, metrics }
}

export type Monitor_Modules = ReturnType<typeof initializeModules>
