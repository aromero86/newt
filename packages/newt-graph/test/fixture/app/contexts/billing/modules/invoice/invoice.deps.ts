import type { EventSource } from 'newt/core'

/** What billing asks of the shop's orders, in its own words: a port. */
export type Orders = {
  total(id: string): Promise<number>
}

/** The shop's events billing reacts to. */
export type OrderEvents = {
  placed: EventSource<{ id: string, productId: string }>
}

export interface Invoice_Deps {
  orders: Orders
  orderEvents: OrderEvents
}
