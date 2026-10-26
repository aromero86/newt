import type { Shop_Modules } from '../shop/initialize-modules'
import type { BillingBase } from './billing-base'
import { Invoice_Module } from './modules/invoice/invoice.module'

export type Billing_ModuleDeps = {
  shop: Pick<Shop_Modules, 'order'>
}

export function initializeModules(base: BillingBase, deps: Billing_ModuleDeps) {
  const invoice = Invoice_Module.initialize(base, {
    orders: { total: id => deps.shop.order.total(id) },
    orderEvents: deps.shop.order.events,
  }, { log: () => {} })
  return { invoice }
}
