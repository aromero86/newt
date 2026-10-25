import { TableRepository } from 'newt/repository'
import type { ShopBase } from '../../shop-base'
import { Category, type CategoryDTO } from './category'

export type CategoryRow = CategoryDTO & { version: number }

export class Category_Repository extends TableRepository<Category, CategoryRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<CategoryRow>('category', { unique: [['name']] }))
  }

  protected toEntity(row: CategoryRow): Category {
    return Category.fromDTO(row)
  }
}
