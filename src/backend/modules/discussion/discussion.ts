import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'

export * from './discussion.schema'

const DiscussionEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  proposalId: z.uuidv7(),
  deltaId: z.uuidv7().nullable(),
  revision: z.number().int().min(0),
  startedBy: z.uuidv7(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.uuidv7().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type DiscussionEntityDTO = z.infer<typeof DiscussionEntitySchema>

/** A conversation on a proposal or one of its deltas. Resolved and reopened, never deleted. */
export class Discussion extends Entity<typeof DiscussionEntitySchema> {

  private constructor(input: EntityInput<DiscussionEntityDTO>, isNew: boolean) {
    super(DiscussionEntitySchema, input, isNew)
  }

  static fromDTO(dto: DiscussionEntityDTO): Discussion {
    return new Discussion(dto, false)
  }

  static start(input: Pick<DiscussionEntityDTO, 'workspaceId' | 'proposalId' | 'deltaId' | 'revision' | 'startedBy'>): Discussion {
    return new Discussion({ ...input, resolvedAt: null, resolvedBy: null }, true)
  }

  resolveBy(userId: string): void {
    if (this.data.resolvedAt === null) this.change({ resolvedAt: new Date().toISOString(), resolvedBy: userId })
  }

  reopen(): void {
    this.change({ resolvedAt: null, resolvedBy: null })
  }
}
