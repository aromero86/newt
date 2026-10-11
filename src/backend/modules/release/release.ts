import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { ReleaseArtifactSchema } from './release.schema'

export * from './release.schema'

const ReleaseEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  name: z.string(),
  description: z.string(),
  publishedBy: z.uuidv7(),
  publishedAt: z.string(),
  added: z.number(),
  changed: z.number(),
  retired: z.number(),
  restored: z.number(),
  /** The picture: written once with the release, and read apart, since it is big. */
  artifacts: z.array(ReleaseArtifactSchema).nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type ReleaseEntityDTO = z.infer<typeof ReleaseEntitySchema>

/** A picture of a workspace's definition in force, taken when its product was released. It never changes. */
export class Release extends Entity<typeof ReleaseEntitySchema> {

  private constructor(input: EntityInput<ReleaseEntityDTO>, isNew: boolean) {
    super(ReleaseEntitySchema, input, isNew)
  }

  static fromDTO(dto: ReleaseEntityDTO): Release {
    return new Release(dto, false)
  }

  static publish(input: Omit<EntityInput<ReleaseEntityDTO>, 'publishedAt'>): Release {
    return new Release({ ...input, publishedAt: new Date().toISOString() }, true)
  }

  get name(): string {
    return this.data.name
  }

  get publishedAt(): string {
    return this.data.publishedAt
  }
}
