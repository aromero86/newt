import { Order_Module } from './modules/order/order.module'
import { Product_Module } from './modules/product/product.module'
import type { ShopBase } from './shop-base'

export function initializeModules(base: ShopBase) {
  const product = Product_Module.initialize(base)
  const order = Order_Module.initialize(base, { product })
  return { product, order }
}

export type Shop_Modules = ReturnType<typeof initializeModules>
