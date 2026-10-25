import type { DomainEvent } from 'newt/core'
import type { CategoryDTO } from '../category.schema'

export class Category_Created implements DomainEvent<CategoryDTO> {
  static readonly eventName = 'category.created'
  readonly name = Category_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CategoryDTO) {}
}
