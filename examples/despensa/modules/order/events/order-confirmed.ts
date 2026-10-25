import type { DomainEvent } from 'newt/core'
import type { OrderDTO } from '../order.schema'

export class Order_Confirmed implements DomainEvent<OrderDTO> {
  static readonly eventName = 'order.confirmed'
  readonly name = Order_Confirmed.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: OrderDTO) {}
}
