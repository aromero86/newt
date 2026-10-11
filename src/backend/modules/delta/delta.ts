import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import {
  DeltaChangeSchema,
  DeltaContentSchema,
  DeltaKindSchema,
  DeltaOperationSchema,
  DeltaVerdictSchema,
  type DeltaChange,
  type DeltaContentDTO,
  type DeltaStatus,
  type DeltaVerdict,
} from './delta.schema'

export * from './delta.schema'

const DeltaEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  proposalId: z.uuidv7(),
  kind: DeltaKindSchema,
  operation: DeltaOperationSchema,
  targetId: z.uuidv7(),
  // The working copy.
  targetLabel: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  removed: z.boolean(),
  /** As the last revision published it; null until one does. */
  published: DeltaContentSchema.nullable(),
  /** Removed by a published revision: only history now. */
  gone: z.boolean(),
  /** The sentences of the document it comes from. Not part of what it says: rewording them changes nothing. */
  sources: z.array(z.string()),
  /** Verdicts on what is published. */
  reviews: z.array(z.object({ userId: z.uuidv7(), verdict: DeltaVerdictSchema, reason: z.string(), at: z.string() })),
  /** What the revision being published does to it; written once, with the delta. */
  snapshot: z.object({
    revision: z.number().int().min(1),
    change: DeltaChangeSchema,
    content: DeltaContentSchema.nullable(),
    previous: DeltaContentSchema.nullable(),
  }).nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type DeltaEntityDTO = z.infer<typeof DeltaEntitySchema>

/**
 * One change to one artifact, across the revisions of its proposal: its working
 * copy, what was last published of it, and what each person thinks of that.
 */
export class Delta extends Entity<typeof DeltaEntitySchema> {

  private constructor(input: EntityInput<DeltaEntityDTO>, isNew: boolean) {
    super(DeltaEntitySchema, input, isNew)
  }

  static fromDTO(dto: DeltaEntityDTO): Delta {
    return new Delta(dto, false)
  }

  static create(input: Omit<EntityInput<DeltaEntityDTO>, 'reviews' | 'published' | 'removed' | 'gone' | 'snapshot'>): Delta {
    return new Delta({ ...input, reviews: [], published: null, removed: false, gone: false, snapshot: null }, true)
  }

  get proposalId(): string {
    return this.data.proposalId
  }

  get kind() {
    return this.data.kind
  }

  get operation() {
    return this.data.operation
  }

  get targetId(): string {
    return this.data.targetId
  }

  get reviews() {
    return this.data.reviews
  }

  get removed(): boolean {
    return this.data.removed
  }

  /** The working copy. */
  get content(): DeltaContentDTO {
    return { targetLabel: this.data.targetLabel, before: this.data.before, after: this.data.after }
  }

  get published(): DeltaContentDTO | null {
    return this.data.published
  }

  /** The working copy says something the last revision did not. */
  get isUnpublished(): boolean {
    const { published } = this.data
    return this.data.removed || published === null || !sameMeaning(published.after, this.data.after)
  }

  /** At least one approval and no rejection is `approved`; one rejection is enough for `rejected`. */
  get status(): DeltaStatus {
    const verdicts = this.data.reviews.map(review => review.verdict)
    if (verdicts.includes('rejected')) return 'rejected'
    return verdicts.includes('approved') ? 'approved' : 'pending'
  }

  /** A new working copy. Verdicts stay: they are on what is published. */
  rewrite(content: DeltaContentDTO, sources: string[]): void {
    this.change({ ...content, sources })
  }

  /** Out of the working copy. One never published goes for good; the rest wait for a revision. */
  remove(): void {
    if (this.data.published === null) this.markAsDeleted()
    else this.change({ removed: true })
  }

  undoRemove(): void {
    this.change({ removed: false })
  }

  /** Back to what is published; one never published goes. */
  discard(): void {
    const { published } = this.data
    if (published === null) this.markAsDeleted()
    else this.change({ ...published, removed: false })
  }

  /**
   * Publishes the working copy in this revision. A delta that changed, or goes,
   * loses its verdicts: they were about what it said before.
   */
  publish(revision: number): DeltaChange {
    const previous = this.data.published
    const content = this.content
    const change: DeltaChange = this.data.removed ? 'removed' : previous === null ? 'added' : this.isUnpublished ? 'changed' : 'unchanged'

    this.change({
      published: change === 'removed' ? previous : content,
      gone: change === 'removed',
      reviews: change === 'changed' || change === 'removed' ? [] : this.data.reviews,
      snapshot: { revision, change, content: change === 'removed' ? null : content, previous },
    })
    return change
  }

  /** Each person has one verdict; a new one replaces theirs. */
  review(userId: string, verdict: DeltaVerdict, reason: string): void {
    const others = this.data.reviews.filter(review => review.userId !== userId)
    this.change({ reviews: [...others, { userId, verdict, reason, at: new Date().toISOString() }] })
  }

  withdraw(userId: string): void {
    this.change({ reviews: this.data.reviews.filter(review => review.userId !== userId) })
  }
}

/** The same state, leaving aside spaces around the text. */
function sameMeaning(a: unknown, b: unknown): boolean {
  return JSON.stringify(trimmed(a)) === JSON.stringify(trimmed(b))
}

function trimmed(value: unknown): unknown {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(trimmed)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, trimmed(each)]))
  return value
}
