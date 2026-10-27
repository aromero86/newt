import type { MonitorBase } from '../../monitor-base'

/** Every module of `monitor`, each one after the modules it uses. */
export function initializeModules(_base: MonitorBase) {
  return {}
}

export type Monitor_Modules = ReturnType<typeof initializeModules>
