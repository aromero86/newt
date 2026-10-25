import type { DomainEvent } from 'newt/core'
import type { CategoryDTO } from '../category.schema'

export class Category_Deleted implements DomainEvent<CategoryDTO> {
  static readonly eventName = 'category.deleted'
  readonly name = Category_Deleted.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CategoryDTO) {}
}
