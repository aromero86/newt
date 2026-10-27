import { describe, expect, test } from 'bun:test'
import { eventsOf, Module, now, UseCase, type DomainEvent, type EventSource } from '../../core'
import type { Store } from '../../port-store'
import { Base } from '../base'
import { describeApplication } from './describe-application'

/** A store none of these touch: the registry is filled as modules are built, before anything is stored. */
const store = { outbox: {} } as unknown as Store

class Order_Placed implements DomainEvent<{ id: string }> {
  static readonly eventName = 'order.placed'
  readonly name = Order_Placed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

class Product_Module extends Module {
  constructor(base: Base) {
    super('product', base.invocations)
  }

  @UseCase()
  async get() {}
}

/** What the order module is given: a module, a port in its own words, and an object of another context's modules. */
type Order_Deps = { product: Product_Module, payments: { charge: () => Promise<void> }, billing: { invoice: Invoice_Module } }

class Order_Module extends Module {
  readonly events
  readonly nightly

  constructor(base: Base, private readonly deps: Order_Deps) {
    super('order', base.invocations, deps)
    this.events = eventsOf(base.bus, { placed: Order_Placed })
    this.nightly = base.schedules.define('order.nightly', '0 3 * * *')
  }

  @UseCase()
  async place() {}

  @UseCase({ writesTo: ['product'], retryOnConflict: false })
  async cancel() {}
}

class Invoice_Module extends Module {
  /** Another module's events, kept as it was given them: not its own. */
  readonly orders: EventSource<{ id: string }>

  constructor(base: Base, deps: { orders: Order_Module['events'] }) {
    super('invoice', base.invocations, deps)
    this.orders = deps.orders.placed
  }

  @UseCase()
  async open() {}
}

function application() {
  const shop = new Base({ name: 'shop', store })
  const billing = new Base({ name: 'billing', store })
  const product = new Product_Module(shop)
  // billing's invoice is built later in its own context: the order module is handed it through an object.
  const deps: Order_Deps = { product, payments: { charge: async () => {} }, billing: { invoice: undefined as never } }
  const order = new Order_Module(shop, deps)
  deps.billing.invoice = new Invoice_Module(billing, { orders: order.events })
  order.events.placed.subscribe(() => {}, { strategy: 'handler', queue: 'invoice.open.on.order.placed', attempts: 3, when: () => true })
  order.events.placed.subscribe(() => {}, { strategy: 'fire-and-forget' })
  return { shop, billing }
}

describe('describeApplication', () => {
  test('lists each context with its modules, their use cases and the events they tell, schedules among them', () => {
    const [shop] = describeApplication(Object.values(application())).contexts

    expect(shop!.name).toBe('shop')
    expect(shop!.modules.map(module => module.id)).toEqual(['shop/product', 'shop/order'])
    const order = shop!.modules[1]!
    expect(order.className).toBe('Order_Module')
    expect(order.useCases).toEqual([
      { id: 'shop/order.place', name: 'order.place', writesTo: [], retryOnConflict: true },
      { id: 'shop/order.cancel', name: 'order.cancel', writesTo: ['product'], retryOnConflict: false },
    ])
    expect(order.events).toEqual([
      { id: 'shop/order.placed', name: 'order.placed', schedule: null },
      { id: 'shop/order.nightly', name: 'order.nightly', schedule: { cron: '0 3 * * *' } },
    ])
  })

  test('tells what each module depends on: modules of any context, events of another module, and ports', () => {
    const [shop, billing] = describeApplication(Object.values(application())).contexts

    expect(shop!.modules[1]!.deps).toEqual([
      { name: 'product', kind: 'module', target: 'shop/product' },
      { name: 'payments', kind: 'port', target: null },
      { name: 'billing.invoice', kind: 'module', target: 'billing/invoice' },
    ])
    const invoice = billing!.modules[0]!
    expect(invoice.deps).toEqual([{ name: 'orders', kind: 'events', target: 'shop/order', events: ['order.placed'] }])
    // The events it keeps were given to it: they are the order module's.
    expect(invoice.events).toEqual([])
    expect(shop!.uses).toEqual(['billing'])
    expect(billing!.uses).toEqual(['shop'])
  })

  test('lists the subscriptions to its events, and forgets one unsubscribed', () => {
    const { shop, billing } = application()

    expect(describeApplication([shop, billing]).contexts[0]!.subscriptions).toEqual([
      { event: 'shop/order.placed', strategy: 'handler', queue: 'invoice.open.on.order.placed', handler: 'invoice.open', attempts: 3, filtered: true },
      { event: 'shop/order.placed', strategy: 'fire-and-forget', queue: null, handler: null, attempts: null, filtered: null },
    ])
    shop.bus.subscribe('order.placed', () => {})()
    expect(describeApplication([shop]).contexts[0]!.subscriptions).toHaveLength(2)
  })

  test('takes the place of a module built again in its context, and knows none that passed no deps of any', () => {
    const shop = new Base({ name: 'shop', store })
    new Product_Module(shop)
    const again = new Product_Module(shop)

    const [product] = describeApplication([shop]).contexts[0]!.modules
    expect(product!.useCases.map(useCase => useCase.name)).toEqual(['product.get'])
    expect(product!.deps).toEqual([])
    expect(shop.invocations.registry.registeredModules[0]!.instance).toBe(again)
  })
})
