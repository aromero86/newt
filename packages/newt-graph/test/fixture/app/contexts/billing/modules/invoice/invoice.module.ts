import { eventsOf, Module, UseCase } from 'newt/core'
import type { BillingBase } from '../../billing-base'
import { Invoice_Issued } from './events/invoice-issued'
import type { Invoice_Deps } from './invoice.deps'
import type { Invoice_Options } from './invoice-options'
import { registerInvoiceWorkers } from './invoice.workers'

export class Invoice_Module extends Module {

  static initialize(base: BillingBase, deps: Invoice_Deps, options: Invoice_Options): Invoice_Module {
    const module = new Invoice_Module(base, deps)
    registerInvoiceWorkers(module, deps, options)
    return module
  }

  readonly events
  readonly nightly

  private constructor(private readonly base: BillingBase, private readonly deps: Invoice_Deps) {
    super('invoice', base.invocations)
    this.events = eventsOf(base.bus, { issued: Invoice_Issued })
    this.nightly = base.schedules.define('invoice.nightly', '0 2 * * *')
  }

  @UseCase()
  async issue(orderId: string): Promise<void> {
    const total = await this.deps.orders.total(orderId)
    await this.base.bus.publish(new Invoice_Issued({ orderId, total }))
  }

  @UseCase()
  async remind(): Promise<void> {}
}
