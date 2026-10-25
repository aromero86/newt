import type { z } from 'zod'
import type { FilterField } from './filter-field'

type Leaf<Fields extends Record<string, FilterField>> = {
  [K in keyof Fields & string]:
    | (Exclude<Fields[K]['ops'][number], 'in'> extends never ? never : { field: K, op: Exclude<Fields[K]['ops'][number], 'in'>, value: z.infer<Fields[K]['value']> })
    | ('in' extends Fields[K]['ops'][number] ? { field: K, op: 'in', value: z.infer<Fields[K]['value']>[] } : never)
}[keyof Fields & string]

/**
 * A filter as a client sends it: a condition on one of the fields it may use, or a
 * group of them, every one (`and`) or at least one (`or`).
 *
 * ```ts
 * { or: [{ field: 'price', op: 'lt', value: 500 }, { field: 'brand', op: 'in', value: ['acme', 'zeta'] }] }
 * ```
 */
export type FilterNode<Fields extends Record<string, FilterField>> =
  | Leaf<Fields>
  | { and: FilterNode<Fields>[] }
  | { or: FilterNode<Fields>[] }
