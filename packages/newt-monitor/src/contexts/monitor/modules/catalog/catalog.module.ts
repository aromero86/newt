import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { CatalogFilterSchema, CatalogItem, type CatalogItemDTO } from './catalog'
import type { Catalog_Deps } from './catalog.deps'
import { CatalogItem_Repository } from './catalog.repository'
import { registerCatalogRoutes } from './catalog.routes'
import { registerCatalogWorkers } from './catalog.workers'
import { CatalogItemNotFound } from './errors/catalog-item-not-found'
import { itemsOf } from './services/items-of'

/**
 * Every part any version of each application had: its contexts, modules, use cases and
 * events, each with when it first appeared, when it was last there, and when it went.
 * Nothing is ever lost: what goes is archived, and comes back as it was.
 */
export class Catalog_Module extends Module {

  static initialize(base: MonitorBase, deps: Catalog_Deps): Catalog_Module {
    const module = new Catalog_Module(base, new CatalogItem_Repository(base), deps)
    registerCatalogRoutes(base, module)
    registerCatalogWorkers(module, deps)
    return module
  }

  private constructor(base: MonitorBase, private readonly repo: CatalogItem_Repository, private readonly deps: Catalog_Deps) {
    super('catalog', base.invocations, deps)
  }

  /**
   * Brings an application's items to its last version: what is new appears, what is
   * there is seen, what is gone is archived. It reads the last version whatever told
   * it to, so running it twice, or late, comes to the same; after its application is
   * deleted, to nothing.
   */
  @UseCase()
  async record(appId: string): Promise<void> {
    // Told late, its application may be deleted since: there is nothing to bring.
    if (!await this.deps.app.find(appId)) return
    const version = await this.deps.structure.latest(appId)
    const known = new Map((await this.repo.allOf(appId)).map(item => [item.key, item]))
    const changed: CatalogItem[] = []
    for (const described of itemsOf(version.description)) {
      const key = `${described.kind}:${described.itemId}`
      const item = known.get(key)
      known.delete(key)
      if (!item) changed.push(CatalogItem.appear(appId, described, version.takenAt))
      else {
        item.seen(described, version.takenAt)
        if (item.hasPendingChanges) changed.push(item)
      }
    }
    for (const gone of known.values()) {
      gone.archive(version.takenAt)
      if (gone.hasPendingChanges) changed.push(gone)
    }
    await this.repo.persistAll(appId, changed)
  }

  /** A page of an application's items, in the order they appeared: those there now, unless `filter` asks for more. */
  @UseCase()
  async list(appId: string, filter: unknown, page: PageRequest): Promise<Page<CatalogItemDTO>> {
    const { kind, context, module, status } = CatalogFilterSchema.parse(filter)
    await this.deps.app.get(appId)
    const criteria = {
      appId,
      ...(kind ? { kind } : {}),
      ...(context ? { context } : {}),
      ...(module ? { module } : {}),
      ...(status === 'active' ? { archivedAt: null } : status === 'archived' ? { archivedAt: { ne: null } } : {}),
    }
    return mapPage(await this.repo.page(criteria, page), item => item.toDTO())
  }

  @UseCase()
  async get(appId: string, id: string): Promise<CatalogItemDTO> {
    return (await this.resolve(() => this.repo.find({ id, appId }), () => new CatalogItemNotFound(id))).toDTO()
  }

  /** Forgets everything of an application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }
}
