import type { DomainEvent } from 'newt/core'
import type { BrandDTO } from '../brand.schema'

export class Brand_Created implements DomainEvent<BrandDTO> {
  static readonly eventName = 'brand.created'
  readonly name = Brand_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BrandDTO) {}
}
