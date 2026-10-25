import type { DomainEvent } from 'newt/core'
import type { OrderDTO } from '../order.schema'

export class Order_Cancelled implements DomainEvent<OrderDTO> {
  static readonly eventName = 'order.cancelled'
  readonly name = Order_Cancelled.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: OrderDTO) {}
}
