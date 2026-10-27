import type { MonitorConfig } from '../../config'
import type { MonitorBase } from '../../monitor-base'
import type { AppClient } from '../../shared/app-client/app-client'
import { HttpAppClient } from '../../shared/app-client/http-app-client'
import { KeyCipher } from '../../shared/key-cipher'
import { App_Module } from './modules/app/app.module'
import { Connection_Module } from './modules/connection/connection.module'
import { Session_Module } from './modules/session/session.module'

/** What the modules are given from outside: the applications, over HTTP, unless a test gives another way to them. */
export type Monitor_ModuleDeps = { client?: AppClient }

/** Every module of `monitor`, each one after the modules it uses. */
export function initializeModules(base: MonitorBase, config: MonitorConfig, deps: Monitor_ModuleDeps = {}) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  const app = App_Module.initialize(base, { cipher: new KeyCipher(config.secret) })
  const connection = Connection_Module.initialize(base, { app, client: deps.client ?? new HttpAppClient() })
  return { session, app, connection }
}

export type Monitor_Modules = ReturnType<typeof initializeModules>
