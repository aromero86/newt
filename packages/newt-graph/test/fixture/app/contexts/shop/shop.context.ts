import type { Store } from 'newt/port-store'
import { initializeModules } from './initialize-modules'
import { ShopBase } from './shop-base'

export function openShop(store: Store) {
  const base = new ShopBase({ name: 'shop', store })
  return { base, modules: initializeModules(base) }
}
