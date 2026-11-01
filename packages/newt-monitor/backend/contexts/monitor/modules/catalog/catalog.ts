import { Entity, type EntityInput } from 'newt-kit/core'
import { CatalogItemSchema, type CatalogItemDTO, type DescribedItem } from './catalog.schema'

export * from './catalog.schema'

/**
 * A part of an application, from the first version that had it on: kept when it goes
 * (archived), and back when it comes back, its first appearance kept.
 */
export class CatalogItem extends Entity<typeof CatalogItemSchema> {

  private constructor(input: EntityInput<CatalogItemDTO>, isNew: boolean) {
    super(CatalogItemSchema, input, isNew)
  }

  static fromDTO(dto: CatalogItemDTO & { version: number }): CatalogItem {
    return new CatalogItem(dto, false)
  }

  /** A part first seen in the version taken `at`. */
  static appear(appId: string, item: DescribedItem, at: string): CatalogItem {
    return new CatalogItem({ appId, ...item, firstSeenAt: at, lastSeenAt: at, archivedAt: null }, true)
  }

  /** What tells it from any other of its application: its kind and its id. */
  get key(): string {
    return `${this.data.kind}:${this.data.itemId}`
  }

  get isArchived(): boolean {
    return this.data.archivedAt !== null
  }

  /** There, in the version taken `at`, as it describes it: back, if it had gone. */
  seen(item: DescribedItem, at: string): void {
    const details = JSON.stringify(item.details) === JSON.stringify(this.data.details) ? {} : { details: item.details }
    const back = this.isArchived ? { archivedAt: null } : {}
    if (this.data.lastSeenAt === at && !Object.keys(details).length && !Object.keys(back).length) return
    this.change({ lastSeenAt: at, ...details, ...back })
  }

  /** Not in the version taken `at`: gone, and kept. */
  archive(at: string): void {
    if (this.isArchived) return
    this.change({ archivedAt: at })
  }
}
