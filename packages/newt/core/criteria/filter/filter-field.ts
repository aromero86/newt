import type { z } from 'zod'
import type { Operator } from '../operator'

/** One field a client may filter by: the row's field it stands for, its value, and the operators it allows. */
export type FilterField = {
  /** The row's field, which the client never sees: `price` may stand for `priceCents`. */
  field: string
  value: z.ZodType
  ops: readonly Operator[]
}
