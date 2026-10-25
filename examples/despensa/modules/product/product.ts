import { Entity, type EntityInput } from 'newt/core'
import { Product_Created } from './events/product-created'
import { Product_Updated } from './events/product-updated'
import { ProductSchema, type ProductDTO } from './product.schema'

export * from './product.schema'

/** Something the shop sells. */
export class Product extends Entity<typeof ProductSchema> {

  private constructor(input: EntityInput<ProductDTO>, isNew: boolean) {
    super(ProductSchema, input, isNew)
  }

  static fromDTO(dto: ProductDTO): Product {
    return new Product(dto, false)
  }

  static create(input: { name: string, priceCents: number, brandId: string | null, categoryId: string | null }): Product {
    const product = new Product({ ...input, archived: false }, true)
    product.trackEvent(new Product_Created(product.toDTO()))
    return product
  }

  update(changes: Partial<Pick<ProductDTO, 'name' | 'priceCents' | 'brandId' | 'categoryId' | 'archived'>>): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Product_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }
}
