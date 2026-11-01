import { createHash } from 'node:crypto'
import { Entity, now, type EntityInput } from 'newt-kit/core'
import type { ApplicationDescription } from 'newt-kit/runtime'
import { Structure_Changed } from './events/structure-changed'
import { StructureVersionSchema, type StructureVersionDTO, type StructureVersionSummaryDTO } from './structure.schema'

export * from './structure.schema'

/** The hash a description is told by: two the same are the same structure. */
export function hashOf(description: ApplicationDescription): string {
  return createHash('sha256').update(JSON.stringify(description)).digest('hex')
}

/**
 * What an application was made of when it changed. A version is taken only when its
 * hash is not the last one's; once taken, it never changes.
 */
export class StructureVersion extends Entity<typeof StructureVersionSchema> {

  private constructor(input: EntityInput<StructureVersionDTO>, isNew: boolean) {
    super(StructureVersionSchema, input, isNew)
  }

  static fromDTO(dto: StructureVersionDTO & { version: number }): StructureVersion {
    return new StructureVersion(dto, false)
  }

  /** A new version of `appId`'s structure, after `previous`, if there was one. */
  static take(appId: string, description: ApplicationDescription, hash: string, previous: StructureVersion | undefined): StructureVersion {
    const version = new StructureVersion({ appId, hash, description, takenAt: now().toISOString() }, true)
    version.trackEvent(new Structure_Changed({ appId, versionId: version.id, previousVersionId: previous?.id ?? null }))
    return version
  }

  get appId(): string {
    return this.data.appId
  }

  get hash(): string {
    return this.data.hash
  }

  summary(): StructureVersionSummaryDTO {
    const { id, appId, hash, takenAt } = this.data
    return { id, appId, hash, takenAt }
  }
}
