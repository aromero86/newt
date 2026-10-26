import { Module, UseCase } from 'newt/core'
import type { Store } from 'newt/port-store'
import { ShopBase } from '../shop-base'

/** A fake, for tests: newt-graph leaves it out unless asked for tests. */
export class FakeProduct_Module extends Module {

  static initialize(base: ShopBase): FakeProduct_Module {
    return new FakeProduct_Module(base)
  }

  private constructor(base: ShopBase) {
    super('fakeProduct', base.invocations)
  }

  @UseCase()
  async get(id: string): Promise<{ id: string }> {
    return { id }
  }
}

export function openFakeShop(store: Store) {
  return FakeProduct_Module.initialize(new ShopBase({ name: 'shop', store }))
}
