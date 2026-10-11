import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { DeltaKindSchema, DeltaOperationSchema, DeltaVerdictSchema, type DeltaStatus, type DeltaVerdict } from './delta.schema'

export * from './delta.schema'

const DeltaEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  proposalId: z.uuidv7(),
  kind: DeltaKindSchema,
  operation: DeltaOperationSchema,
  targetId: z.uuidv7(),
  targetLabel: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reviews: z.array(z.object({ userId: z.uuidv7(), verdict: DeltaVerdictSchema, reason: z.string(), at: z.string() })),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type DeltaEntityDTO = z.infer<typeof DeltaEntitySchema>

/** One change to one artifact, and what each person thinks of it. */
export class Delta extends Entity<typeof DeltaEntitySchema> {

  private constructor(input: EntityInput<DeltaEntityDTO>, isNew: boolean) {
    super(DeltaEntitySchema, input, isNew)
  }

  static fromDTO(dto: DeltaEntityDTO): Delta {
    return new Delta(dto, false)
  }

  static create(input: Omit<EntityInput<DeltaEntityDTO>, 'reviews'>): Delta {
    return new Delta({ ...input, reviews: [] }, true)
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

  get before(): unknown {
    return this.data.before
  }

  get after(): unknown {
    return this.data.after
  }

  get reviews() {
    return this.data.reviews
  }

  /** At least one approval and no rejection is `approved`; one rejection is enough for `rejected`. */
  get status(): DeltaStatus {
    const verdicts = this.data.reviews.map(review => review.verdict)
    if (verdicts.includes('rejected')) return 'rejected'
    return verdicts.includes('approved') ? 'approved' : 'pending'
  }

  /** A different change: the verdicts were about the old one, so they go. */
  rewrite(changes: { targetLabel: string, before: unknown, after: unknown }): void {
    this.change({ ...changes, reviews: [] })
  }

  /** Each person has one verdict; a new one replaces theirs. */
  review(userId: string, verdict: DeltaVerdict, reason: string): void {
    const others = this.data.reviews.filter(review => review.userId !== userId)
    this.change({ reviews: [...others, { userId, verdict, reason, at: new Date().toISOString() }] })
  }

  withdraw(userId: string): void {
    this.change({ reviews: this.data.reviews.filter(review => review.userId !== userId) })
  }

  remove(): void {
    this.markAsDeleted()
  }
}
