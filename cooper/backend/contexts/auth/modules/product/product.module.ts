import { Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { ProductNotFound } from './errors/product-not-found'
import type { Product_Options } from './product-options'
import { ProductSchema, type ProductDTO } from './product.schema'

/**
 * The apps that sign people in through auth. They are declared in cooper's code, not
 * kept in the store: a product is a piece of the system, not data anyone edits. So
 * this module has no entity and no repository, only what it was given.
 */
export class Product_Module extends Module {

  static initialize(base: AuthBase, options: Product_Options): Product_Module {
    return new Product_Module(base, options.products.map(product => ProductSchema.parse(product)))
  }

  private constructor(base: AuthBase, private readonly products: ProductDTO[]) {
    super('product', base.invocations)
  }

  /** For other modules and contexts: a product by its id. */
  @UseCase()
  async get(id: string): Promise<ProductDTO> {
    const product = this.products.find(each => each.id === id)
    if (!product) throw new ProductNotFound(id)
    return structuredClone(product)
  }
}
