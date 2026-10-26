import { Entity, type EntityInput } from 'newt/core'
import { Category_Created } from './events/category-created'
import { Category_Deleted } from './events/category-deleted'
import { CategorySchema, type CategoryDTO } from './category.schema'

export * from './category.schema'

export class Category extends Entity<typeof CategorySchema> {

  private constructor(input: EntityInput<CategoryDTO>, isNew: boolean) {
    super(CategorySchema, input, isNew)
  }

  static fromDTO(dto: CategoryDTO & { version: number }): Category {
    return new Category(dto, false)
  }

  static create(name: string): Category {
    const category = new Category({ name }, true)
    category.trackEvent(new Category_Created(category.toDTO()))
    return category
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Category_Deleted(this.toDTO()))
  }
}
