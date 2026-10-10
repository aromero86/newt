import type { z } from 'zod'

/**
 * A value with rules of its own, defined once: `schema` checks it where it is
 * stored, `from` turns what someone typed into the value (or refuses it).
 */
export type ValueObject<TValue, TInput = TValue> = {
  readonly schema: z.ZodType<TValue>
  from(input: TInput): TValue
}
