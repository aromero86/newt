import type { DomainEvent } from 'newt/core'
import type { ProductDTO } from '../product.schema'

export class Product_Created implements DomainEvent<ProductDTO> {
  static readonly eventName = 'product.created'
  readonly name = Product_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: ProductDTO) {}
}
