import type { Order_Module } from './order.module'

/**
 * Every order placed is fulfilled in the background; every order cancelled gets its
 * stock back. Each one a job written with the change, run after it is saved, and
 * again if it fails.
 */
export function registerOrderWorkers(orders: Order_Module): void {
  orders.events.placed.subscribe(order => orders.fulfil(order.id), {
    strategy: 'handler',
    queue: 'order.fulfil.on.order.placed',
  })
  orders.events.cancelled.subscribe(order => orders.releaseStock(order.id), {
    strategy: 'handler',
    queue: 'order.releaseStock.on.order.cancelled',
  })
}
