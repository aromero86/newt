import type { MonitorConfig } from '../../config'
import type { MonitorBase } from '../../monitor-base'
import { KeyCipher } from '../../shared/key-cipher'
import { App_Module } from './modules/app/app.module'
import { Session_Module } from './modules/session/session.module'

/** Every module of `monitor`, each one after the modules it uses. */
export function initializeModules(base: MonitorBase, config: MonitorConfig) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  const app = App_Module.initialize(base, { cipher: new KeyCipher(config.secret) })
  return { session, app }
}

export type Monitor_Modules = ReturnType<typeof initializeModules>
