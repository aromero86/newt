import { defineFilter } from 'newt/core'
import { z } from 'zod'

export const MAX_PRICE_CENTS = 10_000_000

export const ProductSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(80),
  /** What it costs, in cents: 1,25 € is 125. Up to 100 000 €, so an order's total is always a safe integer. */
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  /** Who makes it, by id: the brand is another module's. */
  brandId: z.string().nullable(),
  /** Which family it belongs to, by id. */
  categoryId: z.string().nullable(),
  /** No longer sold: lists leave it out unless asked, and orders cannot have it. */
  archived: z.boolean(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const ProductCreateSchema = ProductSchema.pick({ name: true, priceCents: true }).extend({
  brandId: ProductSchema.shape.brandId.default(null),
  categoryId: ProductSchema.shape.categoryId.default(null),
})
export const ProductUpdateSchema = ProductSchema.pick({
  name: true,
  priceCents: true,
  brandId: true,
  categoryId: true,
  archived: true,
}).partial()
export const ProductFiltersSchema = z.object({ archived: z.boolean().optional() })

/** What a client may search products by: these fields, these operators, nothing else. */
export const ProductFilter = defineFilter({
  price: { field: 'priceCents', value: z.number().int(), ops: ['eq', 'lt', 'lte', 'gt', 'gte'] },
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  brand: { field: 'brandId', value: z.string(), ops: ['eq', 'in'] },
  category: { field: 'categoryId', value: z.string(), ops: ['eq', 'in'] },
}, { maxDepth: 3, maxConditions: 10 })

export type ProductDTO = z.infer<typeof ProductSchema>
export type ProductCreateDTO = z.input<typeof ProductCreateSchema>
export type ProductUpdateDTO = z.input<typeof ProductUpdateSchema>
export type ProductFiltersDTO = z.infer<typeof ProductFiltersSchema>
/** A search as a client sends it: groups of conditions on the fields above. */
export type ProductFilterDTO = z.infer<typeof ProductFilter.schema>
