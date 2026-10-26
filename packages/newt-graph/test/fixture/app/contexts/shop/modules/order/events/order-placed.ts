import { now, type DomainEvent } from 'newt/core'

export type OrderPlacement = { id: string, productId: string }

export class Order_Placed implements DomainEvent<OrderPlacement> {
  static readonly eventName = 'order.placed'
  readonly name = Order_Placed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: OrderPlacement) {}
}
