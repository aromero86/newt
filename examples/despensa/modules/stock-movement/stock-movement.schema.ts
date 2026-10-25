import { z } from 'zod'

/**
 * One movement of a product's stock: what came in (positive) or went out
 * (negative). They are only ever added: a product's stock is what they add up to.
 */
export const StockMovementSchema = z.object({
  id: z.uuidv7(),
  productId: z.string(),
  quantity: z.number().int().refine(quantity => quantity !== 0, 'A movement moves something'),
  /** Why: `received`, the order it was reserved for, or `release:<order>` when given back. */
  reference: z.string(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const StockMovementReceiveSchema = z.object({ quantity: z.number().int().positive() })

export type StockMovementDTO = z.infer<typeof StockMovementSchema>
export type StockMovementReceiveDTO = z.input<typeof StockMovementReceiveSchema>
/** What a reservation takes: so many of each product. */
export type StockMovementLineDTO = { productId: string, quantity: number }
