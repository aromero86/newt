import { TableRepository } from 'newt-kit/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { assertAppThere, unlessAppGone } from '../../../../shared/app-gone'
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

  /**
   * The items a version changed, at once, one application at a time: none if the
   * application was deleted meanwhile, its items forgotten.
   */
  async persistAll(appId: string, items: CatalogItem[], isThere: () => Promise<boolean>): Promise<void> {
    if (items.length === 0) return
    await unlessAppGone(() => this.save(items, each => this.write(each), { guard: [`catalog:${appId}`], after: () => assertAppThere(isThere) }))
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
