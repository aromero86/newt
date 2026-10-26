import { z } from 'zod'
import { message } from '../../messages/message'
import type { Criteria } from '../criteria'
import type { Filter } from './filter'
import type { FilterField } from './filter-field'
import type { FilterNode } from './filter-node'

/** The most values an `in` may list. */
const MAX_IN = 100

export type FilterLimits = {
  /** How many groups deep a filter may nest: 3 by default. */
  maxDepth?: number
  /** How many conditions a filter may have in all: 20 by default. */
  maxConditions?: number
}

/**
 * The filters a client may send for a list, and nothing else: the fields it may use,
 * each with the operators it allows, combined in groups (`and`, `or`) within limits.
 * It is part of a module's public contract: declare it in its `.schema.ts`, so the
 * frontend gets its type too.
 *
 * ```ts
 * export const ProductFilter = defineFilter({
 *   price: { field: 'priceCents', value: z.number().int(), ops: ['eq', 'lt', 'lte', 'gt', 'gte'] },
 *   brand: { field: 'brandId', value: z.string(), ops: ['eq', 'in'] },
 * })
 *
 * const criteria = ProductFilter.toCriteria<ProductRow>(ProductFilter.schema.parse(input))
 * ```
 *
 * Every operator a field allows is a query someone can run: an `or` across fields
 * keeps a database from using its indexes. Offer what the data can answer quickly.
 */
export function defineFilter<const Fields extends Record<string, FilterField>>(fields: Fields, limits: FilterLimits = {}): Filter<Fields> {
  const maxDepth = limits.maxDepth ?? 3
  const maxConditions = limits.maxConditions ?? 20

  const leaves = Object.entries(fields).flatMap(([name, { value, ops }]) => {
    const plain = ops.filter(op => op !== 'in')
    return [
      ...(plain.length ? [z.strictObject({ field: z.literal(name), op: z.enum(plain as [string, ...string[]]), value })] : []),
      ...(ops.includes('in') ? [z.strictObject({ field: z.literal(name), op: z.literal('in'), value: z.array(value).max(MAX_IN) })] : []),
    ]
  })
  const node: z.ZodType = z.lazy(() => z.union([
    ...leaves,
    z.strictObject({ and: z.array(node).min(1) }),
    z.strictObject({ or: z.array(node).min(1) }),
  ] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]))

  // The limits are checked first, on the raw input and without recursion: a filter
  // nested thousands deep, or with thousands of conditions, is refused before zod
  // walks it, cheaply and with a 400.
  const schema = z.unknown().superRefine((input, context) => {
    const exceeded = beyond(input, maxDepth, maxConditions)
    if (exceeded === 'depth') context.addIssue({ code: 'custom', message: message('filter_too_deep', { max: maxDepth }) })
    if (exceeded === 'conditions') context.addIssue({ code: 'custom', message: message('filter_too_many_conditions', { max: maxConditions }) })
  }).pipe(node) as unknown as z.ZodType<FilterNode<Fields>>

  const toCriteria = (filter: Node): Record<string, unknown> => {
    if ('and' in filter) return { and: filter.and.map(toCriteria) }
    if ('or' in filter) return { or: filter.or.map(toCriteria) }
    return { [fields[filter.field]!.field]: { [filter.op]: filter.value } }
  }

  return { schema, toCriteria: <Row>(filter: FilterNode<Fields>) => toCriteria(filter as Node) as Criteria<Row> }
}

type Node = { and: Node[] } | { or: Node[] } | { field: string, op: string, value: unknown }

/**
 * Which limit a filter, as it came, goes beyond, if any. Anything but a group counts
 * as a condition, an empty group too (zod refuses it later), so whatever it lets
 * through has at most `maxConditions` leaves and is a small tree.
 */
function beyond(input: unknown, maxDepth: number, maxConditions: number): 'depth' | 'conditions' | null {
  const pending: { node: unknown, depth: number }[] = [{ node: input, depth: 0 }]
  let conditions = 0
  while (pending.length) {
    const { node, depth } = pending.pop()!
    const group = groupOf(node)
    if (!group?.length) {
      if (++conditions > maxConditions) return 'conditions'
      continue
    }
    if (depth + 1 > maxDepth) return 'depth'
    if (conditions + pending.length + group.length > maxConditions * (maxDepth + 1)) return 'conditions'
    for (const each of group) pending.push({ node: each, depth: depth + 1 })
  }
  return null
}

function groupOf(node: unknown): unknown[] | null {
  if (node === null || typeof node !== 'object') return null
  const group = 'and' in node ? node.and : 'or' in node ? node.or : null
  return Array.isArray(group) ? group : null
}
