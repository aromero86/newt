import type { DomainEvent } from 'newt/core'
import type { OrderDTO } from '../order.schema'

export class Order_Placed implements DomainEvent<OrderDTO> {
  static readonly eventName = 'order.placed'
  readonly name = Order_Placed.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: OrderDTO) {}
}
