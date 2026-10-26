import type { Order_Module } from './order.module'

export function registerOrderWorkers(orders: Order_Module): void {
  orders.events.placed.subscribe(order => orders.confirm(order.id), { strategy: 'handler', queue: 'order.confirm.on.order.placed' })
}
