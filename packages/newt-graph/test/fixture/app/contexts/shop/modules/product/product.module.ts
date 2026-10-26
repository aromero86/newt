import { Module, UseCase } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { registerProductRoutes } from './product.routes'

export class Product_Module extends Module {

  static initialize(base: ShopBase): Product_Module {
    const module = new Product_Module(base)
    registerProductRoutes(base, module)
    return module
  }

  private constructor(base: ShopBase) {
    super('product', base.invocations)
  }

  @UseCase()
  async get(id: string): Promise<{ id: string, price: number }> {
    return { id, price: 100 }
  }

  @UseCase()
  async reserve(id: string): Promise<void> {
    await this.get(id)
  }
}
