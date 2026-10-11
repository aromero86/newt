import { z } from 'zod'

export const SearchModuleName = 'search'

/** What a result is. */
export const SearchKindSchema = z.enum(['feature-area', 'feature', 'rule', 'proposal'])

/**
 * Where a result belongs, never mixed in silence: the definition `in force`, what
 * accepted proposals have `planned`, the `proposals` themselves, or `history`
 * (superseded versions, retired artifacts, discarded proposals).
 */
export const SearchLayerSchema = z.enum(['in force', 'planned', 'proposals', 'history'])

/**
 * Whether results are found by their meaning too: the model is `ready`, still
 * `loading` (or indexing what changed), or `unavailable`. Words always work.
 */
export const SearchSemanticSchema = z.enum(['ready', 'loading', 'unavailable'])

/** Which definition to search, and what else. */
export const SearchFilterSchema = z.object({
  query: z.string().trim().min(1, 'Write what to look for').max(500, 'Keep it under 500 characters'),
  kinds: z.array(SearchKindSchema).optional(),
  featureId: z.uuidv7().optional(),
  /** One value per dimension: what applies in all of them. */
  appliesIn: z.array(z.object({ dimensionId: z.uuidv7(), valueId: z.uuidv7() })).default([]),
  /** The definition in force, or the planned one: in force plus what accepted proposals will change. */
  definition: z.enum(['in force', 'planned']).default('in force'),
  /** Superseded versions, retired artifacts and discarded proposals too. */
  history: z.boolean().default(false),
})

/** One result: what it is, where it belongs and enough to show it and link to it. */
export const SearchResultSchema = z.object({
  /** The entry of the index: the cursor of the pages of results. */
  id: z.string(),
  kind: SearchKindSchema,
  layer: SearchLayerSchema,
  /** in force, retired, superseded, planned, or the proposal's state. */
  status: z.string(),
  /** The artifact or the proposal. */
  targetId: z.uuidv7(),
  /** R-7, PROP-3; null for areas and features. */
  key: z.string().nullable(),
  label: z.string(),
  /** The part of its text that was found. */
  snippet: z.string(),
  feature: z.object({ id: z.uuidv7(), name: z.string() }).nullable(),
  /** Where a rule applies, by name; null when it is not a rule, empty when it applies everywhere. */
  scope: z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })).nullable(),
  /** The accepted proposal that plans it. */
  proposal: z.object({ key: z.string(), title: z.string() }).nullable(),
  /** A rule's version, and the one in force now when it is superseded. */
  version: z.number().nullable(),
  currentVersion: z.number().nullable(),
})

export type SearchKind = z.infer<typeof SearchKindSchema>
export type SearchLayer = z.infer<typeof SearchLayerSchema>
export type SearchSemantic = z.infer<typeof SearchSemanticSchema>
export type SearchFilterDTO = z.input<typeof SearchFilterSchema>
export type SearchResultDTO = z.infer<typeof SearchResultSchema>
/** A page of results, and whether they were found by meaning too. */
export type SearchPageDTO = { items: SearchResultDTO[], hasMore: boolean, total: number, semantic: SearchSemantic }
