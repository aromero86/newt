import type { MonitorConfig } from '../../config'
import type { MonitorBase } from '../../monitor-base'
import { Session_Module } from './modules/session/session.module'

/** Every module of `auth`: who may sign in to the monitor, and their sessions. */
export function initializeModules(base: MonitorBase, config: MonitorConfig) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  return { session }
}

export type Auth_Modules = ReturnType<typeof initializeModules>
