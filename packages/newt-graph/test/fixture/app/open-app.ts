import type { Store } from 'newt/port-store'
import { openBilling } from './contexts/billing/billing.context'
import { openShop } from './contexts/shop/shop.context'

/** Both contexts, the shop first: billing uses it. */
export function openApp(stores: { shop: Store, billing: Store }) {
  const shop = openShop(stores.shop)
  const billing = openBilling(stores.billing, { shop: shop.modules })
  return { shop, billing }
}
