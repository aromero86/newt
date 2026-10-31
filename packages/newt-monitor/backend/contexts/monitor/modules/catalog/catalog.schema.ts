import { z } from 'zod'

/** What the catalog keeps: each part of an application, by kind. */
export const CatalogKindSchema = z.enum(['context', 'module', 'useCase', 'event'])

/**
 * A part of an application, as the catalog keeps it: what it is (its kind and its id,
 * describeApplication's: `boards/card.create`), where (its context, its module), what describes
 * it, and when it was there.
 */
export const CatalogItemSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  kind: CatalogKindSchema,
  itemId: z.string().min(1),
  context: z.string(),
  /** Its module's name; null for a context. */
  module: z.string().nullable(),
  name: z.string().min(1),
  /** What the description said of it: a use case's `writesTo`, an event's schedule, a module's deps. */
  details: z.record(z.string(), z.unknown()),
  /** When the first version that had it was taken. */
  firstSeenAt: z.iso.datetime(),
  /** When the last version that had it was taken: for one still there, the last version's. */
  lastSeenAt: z.iso.datetime(),
  /** When the first version without it was taken; null while it is there. */
  archivedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** Which items a list shows: by kind, context and module, those there now unless asked. */
export const CatalogFilterSchema = z.object({
  kind: CatalogKindSchema.optional(),
  context: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
})

export type CatalogKind = z.infer<typeof CatalogKindSchema>
export type CatalogItemDTO = z.infer<typeof CatalogItemSchema>
export type CatalogFilterDTO = z.input<typeof CatalogFilterSchema>

/** A part of an application as a version describes it: what the catalog is told it has now. */
export type DescribedItem = Pick<CatalogItemDTO, 'kind' | 'itemId' | 'context' | 'module' | 'name' | 'details'>
