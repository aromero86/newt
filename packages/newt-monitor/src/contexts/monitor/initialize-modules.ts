import type { MonitorConfig } from '../../config'
import type { MonitorBase } from '../../monitor-base'
import { Session_Module } from './modules/session/session.module'

/** Every module of `monitor`, each one after the modules it uses. */
export function initializeModules(base: MonitorBase, config: MonitorConfig) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  return { session }
}

export type Monitor_Modules = ReturnType<typeof initializeModules>
