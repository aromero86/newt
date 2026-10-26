import type { Invoice_Deps } from './invoice.deps'
import type { Invoice_Module } from './invoice.module'
import type { Invoice_Options } from './invoice-options'

export function registerInvoiceWorkers(invoices: Invoice_Module, deps: Invoice_Deps, options: Invoice_Options): void {
  deps.orderEvents.placed.subscribe(order => invoices.issue(order.id), { strategy: 'handler', queue: 'invoice.issue.on.order.placed', attempts: 7 })
  invoices.nightly.subscribe(() => invoices.remind(), { strategy: 'handler', queue: 'invoice.remind.on.invoice.nightly' })
  invoices.events.issued.subscribe(invoice => options.log(`issued ${invoice.orderId}`), { strategy: 'fire-and-forget' })
}
