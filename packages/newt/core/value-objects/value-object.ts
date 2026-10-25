import type { z } from 'zod'

/**
 * A value with rules of its own, defined once: `schema` checks it where it is
 * stored, `from` turns what someone typed into the value (or refuses it). Its type
 * is branded when only `from` or `schema` should make one: a plain string is then
 * not an `Email` to the compiler until it went through them.
 */
export type ValueObject<TValue, TInput = TValue> = {
  readonly schema: z.core.$ZodType<TValue>
  from(input: TInput): TValue
}
