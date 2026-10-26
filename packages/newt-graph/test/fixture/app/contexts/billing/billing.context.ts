import type { Store } from 'newt/port-store'
import { BillingBase } from './billing-base'
import { initializeModules, type Billing_ModuleDeps } from './initialize-modules'

export function openBilling(store: Store, deps: Billing_ModuleDeps) {
  const base = new BillingBase({ name: 'billing', store })
  return { base, modules: initializeModules(base, deps) }
}
