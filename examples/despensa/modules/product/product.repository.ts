import { TableRepository } from 'newt/repository'
import type { ShopBase } from '../../shop-base'
import { ProductNameTaken } from './errors/product-name-taken'
import { Product, type ProductDTO } from './product'

export type ProductRow = ProductDTO & { version: number }

export class Product_Repository extends TableRepository<Product, ProductRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<ProductRow>('product', { types: { archived: 'boolean' }, unique: [['name']] }))
  }

  protected toEntity(row: ProductRow): Product {
    return Product.fromDTO(row)
  }

  /**
   * Saves a product only if no other one has its name, whatever the case: checked
   * after the write, in its transaction, guarding the name in lower case, so no other
   * save of it slips in between. `Rice` and `RICE` saved at once cannot both get it;
   * the table's unique name only tells the exact same one apart.
   */
  async persistWithNameFree(product: Product): Promise<void> {
    const { name } = product.toDTO()
    await this.save([product], each => this.write(each), {
      guard: [`productName:${name.toLowerCase()}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new ProductNameTaken(name)
      },
    })
  }
}
