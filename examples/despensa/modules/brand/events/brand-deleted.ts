import type { DomainEvent } from 'newt/core'
import type { BrandDTO } from '../brand.schema'

export class Brand_Deleted implements DomainEvent<BrandDTO> {
  static readonly eventName = 'brand.deleted'
  readonly name = Brand_Deleted.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BrandDTO) {}
}
