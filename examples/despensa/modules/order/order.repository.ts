import { TableRepository } from 'newt/store'
import type { ShopBase } from '../../shop-base'
import { Order, type OrderDTO } from './order'

export type OrderRow = OrderDTO & { version: number }

export class Order_Repository extends TableRepository<Order, OrderRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<OrderRow>('order', { types: { lines: 'json' } }))
  }

  protected toEntity(row: OrderRow): Order {
    return Order.fromDTO(row)
  }
}
