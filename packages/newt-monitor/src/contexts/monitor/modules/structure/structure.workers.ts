import type { Structure_Deps } from './structure.deps'
import type { Structure_Module } from './structure.module'

/**
 * When the structure is read, besides the button: every hour, and as soon as there is
 * something new to read it from (an application registered, restored, or moved to
 * another address or key). Each a job: one whose application does not answer is
 * recorded so, and is no failure. And when it is forgotten: its application deleted.
 */
export function registerStructureWorkers(structure: Structure_Module, deps: Structure_Deps): void {
  structure.hourly.subscribe(() => structure.refreshAll(), {
    strategy: 'handler',
    queue: 'structure.refreshAll.on.structure.hourly',
  })
  deps.app.events.registered.subscribe(app => structure.refresh(app.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.registered',
  })
  deps.app.events.restored.subscribe(app => structure.refresh(app.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.restored',
  })
  deps.app.events.updated.subscribe(({ dto }) => structure.refresh(dto.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.updated',
    when: ({ changed }) => changed.includes('url') || changed.includes('key'),
  })
  deps.app.events.deleted.subscribe(app => structure.forget(app.id), {
    strategy: 'handler',
    queue: 'structure.forget.on.app.deleted',
  })
}
