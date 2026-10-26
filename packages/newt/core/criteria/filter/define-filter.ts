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

  const schema = node.superRefine((filter, context) => {
    const { depth, conditions } = measure(filter as Node)
    if (depth > maxDepth) context.addIssue({ code: 'custom', message: message('filter_too_deep', { max: maxDepth }) })
    if (conditions > maxConditions) context.addIssue({ code: 'custom', message: message('filter_too_many_conditions', { max: maxConditions }) })
  }) as unknown as z.ZodType<FilterNode<Fields>>

  const toCriteria = (filter: Node): Record<string, unknown> => {
    if ('and' in filter) return { and: filter.and.map(toCriteria) }
    if ('or' in filter) return { or: filter.or.map(toCriteria) }
    return { [fields[filter.field]!.field]: { [filter.op]: filter.value } }
  }

  return { schema, toCriteria: <Row>(filter: FilterNode<Fields>) => toCriteria(filter as Node) as Criteria<Row> }
}

type Node = { and: Node[] } | { or: Node[] } | { field: string, op: string, value: unknown }

function measure(node: Node): { depth: number, conditions: number } {
  const group = 'and' in node ? node.and : 'or' in node ? node.or : null
  if (!group) return { depth: 0, conditions: 1 }
  const inside = group.map(measure)
  return { depth: 1 + Math.max(0, ...inside.map(each => each.depth)), conditions: inside.reduce((sum, each) => sum + each.conditions, 0) }
}
