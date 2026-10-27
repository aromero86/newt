import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { CatalogItem, type CatalogItemDTO } from './catalog'

export type CatalogItemRow = CatalogItemDTO & { version: number }

export class CatalogItem_Repository extends TableRepository<CatalogItem, CatalogItemRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. Each item says its application.
    super(base, base.store.table<CatalogItemRow>('catalog_item', { types: { details: 'json' } }), { scope: 'none' })
  }

  protected toEntity(row: CatalogItemRow): CatalogItem {
    return CatalogItem.fromDTO(row)
  }

  /**
   * Every item of an application, archived ones too: what a new version is compared
   * with. Whole: an application's parts are counted in hundreds, not more.
   */
  allOf(appId: string): Promise<CatalogItem[]> {
    return this.find({ appId })
  }

  /** The items a version changed, at once, one application at a time. */
  async persistAll(appId: string, items: CatalogItem[]): Promise<void> {
    if (items.length === 0) return
    await this.save(items, each => this.write(each), { guard: [`catalog:${appId}`] })
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
