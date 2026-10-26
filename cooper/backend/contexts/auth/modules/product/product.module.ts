import { Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { ProductNotFound } from './errors/product-not-found'
import type { Product_Options } from './product-options'
import { ProductSchema, type ProductDTO } from './product.schema'

/** The same address, written either way: with or without the last slash. */
const sameResource = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

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

  @UseCase()
  async list(): Promise<ProductDTO[]> {
    return structuredClone(this.products)
  }

  /** For the web-session helper and other contexts: a product by its id. */
  @UseCase()
  async get(id: string): Promise<ProductDTO> {
    const product = this.products.find(each => each.id === id)
    if (!product) throw new ProductNotFound(id)
    return structuredClone(product)
  }

  /** For `resolveRefs`: the products with these ids, as any module's `find` gives them. */
  @UseCase()
  async find(criteria: { id: string[] }): Promise<ProductDTO[]> {
    return this.products.filter(product => criteria.id.includes(product.id)).map(product => structuredClone(product))
  }

  /**
   * The product whose MCP server is this resource, or, when an MCP client names none,
   * the only one with an MCP server. Null when none is.
   */
  @UseCase()
  async forResource(resource: string | undefined): Promise<ProductDTO | null> {
    const withMcp = this.products.filter(product => product.mcpResource !== null)
    const product = resource === undefined
      ? (withMcp.length === 1 ? withMcp[0] : undefined)
      : withMcp.find(each => sameResource(each.mcpResource!, resource))
    return product ? structuredClone(product) : null
  }
}
