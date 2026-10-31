import type { Catalog_Deps } from './catalog.deps'
import type { Catalog_Module } from './catalog.module'

/** A new version of an application's structure: its items are brought to it. An application deleted: they go. */
export function registerCatalogWorkers(catalog: Catalog_Module, deps: Catalog_Deps): void {
  deps.structure.events.changed.subscribe(({ appId }) => catalog.record(appId), {
    strategy: 'handler',
    queue: 'catalog.record.on.structure.changed',
  })
  deps.app.events.deleted.subscribe(app => catalog.forget(app.id), {
    strategy: 'handler',
    queue: 'catalog.forget.on.app.deleted',
  })
}
