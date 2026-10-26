import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { currentMessages } from '../../messages/current-messages'
import { setMessages } from '../../messages/set-messages'
import { defineFilter } from './define-filter'
import { matches } from '../matches'

const ProductFilter = defineFilter({
  price: { field: 'priceCents', value: z.number().int(), ops: ['eq', 'lt', 'gte'] },
  brand: { field: 'brandId', value: z.string(), ops: ['eq', 'in'] },
}, { maxDepth: 2, maxConditions: 3 })

/** What the frontend gets: the type of a filter it may send. */
type ProductFilterDTO = z.infer<typeof ProductFilter.schema>

describe('defineFilter', () => {
  test('takes groups of the fields and operators it declares, and turns them into criteria in the row fields', () => {
    const filter = ProductFilter.schema.parse({ or: [{ field: 'price', op: 'lt', value: 500 }, { field: 'brand', op: 'in', value: ['acme', 'zeta'] }] })

    expect(ProductFilter.toCriteria<Record<string, unknown>>(filter)).toEqual({ or: [{ priceCents: { lt: 500 } }, { brandId: { in: ['acme', 'zeta'] } }] })
    expect(matches({ priceCents: 900, brandId: 'zeta' }, ProductFilter.toCriteria(filter))).toBe(true)
    expect(matches({ priceCents: 900, brandId: 'other' }, ProductFilter.toCriteria(filter))).toBe(false)
  })

  test('refuses a field, an operator or a value it does not declare', () => {
    expect(ProductFilter.schema.safeParse({ field: 'cost', op: 'eq', value: 1 }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ field: 'brand', op: 'lt', value: 'a' }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ field: 'price', op: 'eq', value: 'cheap' }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ field: 'price', op: 'eq', value: 1, extra: true }).success).toBe(false)
  })

  test('keeps a filter within its limits', () => {
    const leaf = { field: 'price', op: 'eq', value: 1 }

    expect(ProductFilter.schema.safeParse({ and: [{ or: [leaf] }] }).success).toBe(true)
    expect(ProductFilter.schema.safeParse({ and: [{ or: [{ and: [leaf] }] }] }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ or: [leaf, leaf, leaf, leaf] }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ or: [] }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ and: [] }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ or: [leaf, leaf, leaf] }).success).toBe(true)
  })

  test('nests 3 groups deep and takes 20 conditions, unless it says otherwise', () => {
    const Plain = defineFilter({ price: { field: 'priceCents', value: z.number(), ops: ['eq'] } })
    const leaf = { field: 'price', op: 'eq', value: 1 }

    expect(Plain.schema.safeParse({ and: [{ or: [{ and: [leaf] }] }] }).success).toBe(true)
    expect(Plain.schema.safeParse({ and: [{ or: [{ and: [{ or: [leaf] }] }] }] }).success).toBe(false)
    expect(Plain.schema.safeParse({ or: Array(20).fill(leaf) }).success).toBe(true)
    expect(Plain.schema.safeParse({ or: Array(21).fill(leaf) }).success).toBe(false)
  })

  test('an in lists up to 100 values, each one a value of its field', () => {
    const brands = (count: number) => ({ field: 'brand', op: 'in', value: Array.from({ length: count }, (_, i) => `b${i}`) })

    expect(ProductFilter.schema.safeParse(brands(100)).success).toBe(true)
    expect(ProductFilter.schema.safeParse(brands(101)).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ field: 'brand', op: 'in', value: 'acme' }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ field: 'brand', op: 'in', value: [1] }).success).toBe(false)
  })

  test('refuses anything more on a group or an in', () => {
    const leaf = { field: 'price', op: 'eq', value: 1 }

    expect(ProductFilter.schema.safeParse({ and: [leaf], extra: 1 }).success).toBe(false)
    expect(ProductFilter.schema.safeParse({ field: 'brand', op: 'in', value: ['a'], extra: 1 }).success).toBe(false)
  })

  test('turns an and group into an and of criteria', () => {
    const filter = ProductFilter.schema.parse({ and: [{ field: 'price', op: 'gte', value: 100 }, { field: 'brand', op: 'eq', value: 'acme' }] })

    expect(ProductFilter.toCriteria<Record<string, unknown>>(filter)).toEqual({ and: [{ priceCents: { gte: 100 } }, { brandId: { eq: 'acme' } }] })
  })

  test('types what a client may send', () => {
    const ok: ProductFilterDTO = { and: [{ field: 'price', op: 'gte', value: 1 }, { field: 'brand', op: 'in', value: ['a'] }] }
    // @ts-expect-error brand does not allow lt
    const wrong: ProductFilterDTO = { field: 'brand', op: 'lt', value: 'a' }
    expect([ok, wrong].length).toBe(2)
  })
})

describe('the limits of a filter', () => {
  const english = currentMessages.value
  afterEach(() => { currentMessages.value = english })

  test('are checked before the rest: a hostile filter is refused at once, not a stack overflow', () => {
    const leaf = { field: 'price', op: 'eq', value: 1 }
    let deep: unknown = leaf
    for (let i = 0; i < 100_000; i++) deep = { and: [deep] }
    const wide = { or: Array.from({ length: 200_000 }, () => leaf) }
    const hollow = { or: Array.from({ length: 200_000 }, () => ({ and: [] })) }

    const started = performance.now()
    expect(ProductFilter.schema.safeParse(deep).error?.issues.map(issue => issue.message)).toEqual(['A filter nests at most 2 groups deep'])
    expect(ProductFilter.schema.safeParse(wide).error?.issues.map(issue => issue.message)).toEqual(['A filter has at most 3 conditions'])
    expect(ProductFilter.schema.safeParse(hollow).error?.issues.map(issue => issue.message)).toEqual(['A filter has at most 3 conditions'])
    expect(performance.now() - started).toBeLessThan(50)
  })

  test('say why in the application\'s language', () => {
    setMessages({
      filter_too_many_conditions: ({ max }) => `Un filtro tiene como mucho ${max} condiciones`,
      filter_too_deep: ({ max }) => `Un filtro anida como mucho ${max} grupos`,
    })
    const many = { or: [1, 2, 3, 4].map(value => ({ field: 'price', op: 'eq', value })) }
    const deep = { and: [{ or: [{ and: [{ field: 'price', op: 'eq', value: 1 }] }] }] }

    expect(ProductFilter.schema.safeParse(many).error?.issues.map(issue => issue.message)).toEqual(['Un filtro tiene como mucho 3 condiciones'])
    expect(ProductFilter.schema.safeParse(deep).error?.issues.map(issue => issue.message)).toEqual(['Un filtro anida como mucho 2 grupos'])
  })
})
