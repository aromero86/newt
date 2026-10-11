import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { SearchKindSchema, SearchLayerSchema } from './search.schema'

export * from './search.schema'

/** What a result shows, as it was when indexed. */
export const SearchEntryDataSchema = z.object({
  label: z.string(),
  key: z.string().nullable(),
  status: z.string(),
  featureId: z.string().nullable(),
  /** A rule's scope, by ids. */
  scope: z.array(z.object({ dimensionId: z.string(), valueIds: z.array(z.string()) })).nullable(),
  proposal: z.object({ key: z.string(), title: z.string() }).nullable(),
  version: z.number().nullable(),
  currentVersion: z.number().nullable(),
})

const SearchEntryEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  kind: SearchKindSchema,
  targetId: z.uuidv7(),
  layer: SearchLayerSchema,
  /** Which part of the target: '' for the whole, `v2` for a version, `s3` for a section, a delta's id. */
  part: z.string(),
  data: SearchEntryDataSchema,
  text: z.string(),
  contentHash: z.string(),
  /** Null until the model computes it. */
  vector: z.instanceof(Float32Array).nullable(),
  model: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type SearchEntryData = z.infer<typeof SearchEntryDataSchema>
export type SearchEntryDTO = z.infer<typeof SearchEntryEntitySchema>
/** An entry as indexing wants it to be. */
export type SearchEntryDraft = Pick<SearchEntryDTO, 'kind' | 'targetId' | 'layer' | 'part' | 'data' | 'text'>

/** Something that can be found, with its vector once computed. */
export class SearchEntry extends Entity<typeof SearchEntryEntitySchema> {

  private constructor(input: EntityInput<SearchEntryDTO>, isNew: boolean) {
    super(SearchEntryEntitySchema, input, isNew)
  }

  static fromDTO(dto: SearchEntryDTO): SearchEntry {
    return new SearchEntry(dto, false)
  }

  static create(workspaceId: string, draft: SearchEntryDraft): SearchEntry {
    return new SearchEntry({ ...draft, workspaceId, contentHash: SearchEntry.hashOf(draft), vector: null, model: null }, true)
  }

  /** What tells whether an entry changed: its text and what it shows. */
  static hashOf(draft: SearchEntryDraft): string {
    return new Bun.CryptoHasher('sha256').update(JSON.stringify([draft.text, draft.data])).digest('hex')
  }

  /** Where it is in the index: one entry per kind, target, layer and part. */
  static slotOf(entry: Pick<SearchEntryDTO, 'kind' | 'targetId' | 'layer' | 'part'>): string {
    return `${entry.kind}|${entry.targetId}|${entry.layer}|${entry.part}`
  }

  get slot(): string {
    return SearchEntry.slotOf(this.data)
  }

  get contentHash(): string {
    return this.data.contentHash
  }

  get text(): string {
    return this.data.text
  }

  /** What it says now: its vector is computed again if the text changed. */
  rewrite(draft: SearchEntryDraft): void {
    const contentHash = SearchEntry.hashOf(draft)
    const textChanged = draft.text !== this.data.text
    this.change({ data: draft.data, text: draft.text, contentHash, ...(textChanged ? { vector: null, model: null } : {}) })
  }

  embedded(vector: Float32Array, model: string): void {
    this.change({ vector: new Float32Array(vector), model })
  }
}
