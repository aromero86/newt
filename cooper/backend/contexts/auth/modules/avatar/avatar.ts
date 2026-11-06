import { Entity, type EntityInput } from '@newt-kit/newt/core'
import { AvatarSchema, type AvatarDTO } from './avatar.schema'
import { Avatar_Ready } from './events/avatar-ready'
import { Avatar_Removed } from './events/avatar-removed'

export * from './avatar.schema'

/** A picture of someone: its bytes are in the storage, under its id. */
export class Avatar extends Entity<typeof AvatarSchema> {

  private constructor(input: EntityInput<AvatarDTO>, isNew: boolean) {
    super(AvatarSchema, input, isNew)
  }

  static fromDTO(dto: AvatarDTO & { version: number }): Avatar {
    return new Avatar(dto, false)
  }

  /** Someone is about to upload it. */
  static start(input: Pick<AvatarDTO, 'userId' | 'contentType'>): Avatar {
    return new Avatar({ ...input, status: 'pending' }, true)
  }

  get contentType(): AvatarDTO['contentType'] {
    return this.data.contentType
  }

  get isReady(): boolean {
    return this.data.status === 'ready'
  }

  /** What came is what it said: it is their picture now. */
  markReady(): void {
    this.change({ status: 'ready' })
    this.trackEvent(new Avatar_Ready(this.toDTO()))
  }

  /** It was refused, replaced or never finished: it goes, and a worker deletes its bytes. */
  remove(): void {
    this.markAsDeleted()
    this.trackEvent(new Avatar_Removed(this.toDTO()))
  }
}
