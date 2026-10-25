import type { DomainEvent } from 'newt/core'
import type { ProductDTO } from '../product.schema'

/**
 * The whole product as it is now, the fields that changed (`changes`) and what they
 * were before (`previous`): the transition of each one.
 */
type ProductChange = { dto: ProductDTO, changes: Partial<ProductDTO>, previous: Partial<ProductDTO> }

export class Product_Updated implements DomainEvent<ProductChange> {
  static readonly eventName = 'product.updated'
  readonly name = Product_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: ProductChange) {}
}
