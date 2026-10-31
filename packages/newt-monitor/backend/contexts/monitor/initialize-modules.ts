import type { MonitorConfig } from '../../config'
import type { MonitorBase } from '../../monitor-base'
import type { AppClient } from '../../shared/app-client/app-client'
import { HttpAppClient } from '../../shared/app-client/http-app-client'
import { KeyCipher } from '../../shared/key-cipher'
import { App_Module } from './modules/app/app.module'
import { Catalog_Module } from './modules/catalog/catalog.module'
import { Connection_Module } from './modules/connection/connection.module'
import type { MetricsStore } from '../../shared/metrics-store/metrics-store'
import { EventMetrics_Module } from './modules/event-metrics/event-metrics.module'
import { Instances_Module } from './modules/instances/instances.module'
import { Outbox_Module } from './modules/outbox/outbox.module'
import { QueueMetrics_Module } from './modules/queue-metrics/queue-metrics.module'
import { Retention_Module } from './modules/retention/retention.module'
import { Traces_Module } from './modules/traces/traces.module'
import { UseCaseErrors_Module } from './modules/use-case-errors/use-case-errors.module'
import { UseCaseMetrics_Module } from './modules/use-case-metrics/use-case-metrics.module'
import { Structure_Module } from './modules/structure/structure.module'
import { SESSION_COOKIE } from '../auth/modules/session/session.schema'
import type { Auth_Modules } from '../auth/initialize-modules'

/** What the modules are given from outside: auth's, and the applications, over HTTP, unless a test gives another way to them. */
export type Monitor_ModuleDeps = { auth: Auth_Modules, client?: AppClient }

/** Every module of `monitor`, each one after the modules it uses; the metrics modules keep theirs in `metrics`, which the context closes. */
export function initializeModules(base: MonitorBase, config: MonitorConfig, metrics: MetricsStore, deps: Monitor_ModuleDeps) {
  // Every route of the context runs as whoever auth says its session cookie is: none, a 401.
  base.http.authenticateWith(request => deps.auth.session.authenticate(request.cookies.get(SESSION_COOKIE) ?? undefined))
  const client = deps.client ?? new HttpAppClient()
  const app = App_Module.initialize(base, { client }, { cipher: new KeyCipher(config.secret) })
  const connection = Connection_Module.initialize(base, { app, client })
  const structure = Structure_Module.initialize(base, { app, connection })
  const catalog = Catalog_Module.initialize(base, { app, structure })
  const retention = Retention_Module.initialize(base, { app })
  const eventMetrics = EventMetrics_Module.initialize(base, { app, connection, retention }, { store: metrics })
  const useCaseMetrics = UseCaseMetrics_Module.initialize(base, { app, connection, retention }, { store: metrics })
  const useCaseErrors = UseCaseErrors_Module.initialize(base, { app, connection, retention }, { store: metrics })
  const queueMetrics = QueueMetrics_Module.initialize(base, { app, connection, retention }, { store: metrics })
  const outbox = Outbox_Module.initialize(base, { app, connection, retention }, { store: metrics })
  const traces = Traces_Module.initialize(base, { app, connection, retention }, { store: metrics })
  const instances = Instances_Module.initialize(base, { app, connection, retention }, { store: metrics })
  return { app, connection, structure, catalog, retention, eventMetrics, useCaseMetrics, useCaseErrors, queueMetrics, outbox, traces, instances }
}

export type Monitor_Modules = ReturnType<typeof initializeModules>
