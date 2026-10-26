import { Email } from 'newt/core'
import { z } from 'zod'

/**
 * At most this many lines of at most this many units, of products of at most
 * 100 000 € (the product's `MAX_PRICE_CENTS`): a total always a safe integer, and
 * the products of an order read in one query, far below the values a server takes
 * in one `in`.
 */
export const MAX_LINES = 500
export const MAX_QUANTITY = 1_000_000

export const OrderLineSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive().max(MAX_QUANTITY),
  /** The product's price when the order was placed: a later change does not touch it. */
  priceCents: z.number().int().min(0),
})

/**
 * An order, from the moment it is placed. It is `pending` until the stock is
 * reserved for it, a moment later and in the background: then `confirmed`, or
 * `rejected` with the reason. Its customer may cancel it, pending or confirmed.
 */
export const OrderSchema = z.object({
  id: z.uuidv7(),
  /** Who placed it: the actor of the request. */
  customerId: z.string(),
  /** Where its news go. */
  customerEmail: Email.schema,
  lines: z.array(OrderLineSchema).min(1).max(MAX_LINES),
  totalCents: z.number().int().min(0),
  status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled']),
  rejection: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** As typed: the email in any case and with spaces around; it trims them, and `Email` lowers the case. */
export const OrderPlaceSchema = z.object({
  customerEmail: z.string().trim().pipe(z.email()),
  lines: z.array(OrderLineSchema.pick({ productId: true, quantity: true })).min(1).max(MAX_LINES),
})

export type OrderLineDTO = z.infer<typeof OrderLineSchema>
export type OrderDTO = z.infer<typeof OrderSchema>
export type OrderPlaceDTO = z.input<typeof OrderPlaceSchema>
