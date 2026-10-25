import { Email, Entity, type EntityInput } from 'newt/core'
import { Order_Cancelled } from './events/order-cancelled'
import { Order_Confirmed } from './events/order-confirmed'
import { Order_Placed } from './events/order-placed'
import { Order_Rejected } from './events/order-rejected'
import { OrderNotCancellable } from './errors/order-not-cancellable'
import { OrderSchema, type OrderDTO, type OrderLineDTO } from './order.schema'

export * from './order.schema'

/** What it takes to place an order: checked, and priced, by the use case. */
export type OrderPlacement = {
  customerId: string
  /** As typed: it is kept as an `Email`. */
  customerEmail: string
  lines: OrderLineDTO[]
}

/** An order someone placed. */
export class Order extends Entity<typeof OrderSchema> {

  private constructor(input: EntityInput<OrderDTO>, isNew: boolean) {
    super(OrderSchema, input, isNew)
  }

  static fromDTO(dto: OrderDTO): Order {
    return new Order(dto, false)
  }

  static place(input: OrderPlacement): Order {
    const totalCents = input.lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0)
    const order = new Order({ ...input, customerEmail: Email.from(input.customerEmail), totalCents, status: 'pending', rejection: null }, true)
    order.trackEvent(new Order_Placed(order.toDTO()))
    return order
  }

  get isPending(): boolean {
    return this.data.status === 'pending'
  }

  get isCancelled(): boolean {
    return this.data.status === 'cancelled'
  }

  get lines(): OrderLineDTO[] {
    return this.toDTO().lines
  }

  confirm(): void {
    if (!this.isPending) return
    this.change({ status: 'confirmed' })
    this.trackEvent(new Order_Confirmed(this.toDTO()))
  }

  reject(reason: string): void {
    if (!this.isPending) return
    this.change({ status: 'rejected', rejection: reason })
    this.trackEvent(new Order_Rejected(this.toDTO()))
  }

  /** Its customer no longer wants it: what was reserved for it goes back, a moment later. */
  cancel(): void {
    if (this.isCancelled) return
    if (this.data.status === 'rejected') throw new OrderNotCancellable(this.id)
    this.change({ status: 'cancelled' })
    this.trackEvent(new Order_Cancelled(this.toDTO()))
  }
}
