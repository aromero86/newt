import { now, type DomainEvent } from 'newt/core'

export class Order_Cancelled implements DomainEvent<{ id: string }> {
  static readonly eventName = 'order.cancelled'
  readonly name = Order_Cancelled.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}
