import { TableRepository } from 'newt/repository'
import type { ShopBase } from '../../shop-base'
import { Product, type ProductDTO } from './product'

export type ProductRow = ProductDTO & { version: number }

export class Product_Repository extends TableRepository<Product, ProductRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<ProductRow>('product', { types: { archived: 'boolean' }, unique: [['name']] }))
  }

  protected toEntity(row: ProductRow): Product {
    return Product.fromDTO(row)
  }
}
