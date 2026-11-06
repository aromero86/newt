import { TableRepository } from '@newt-kit/newt/repository'
import type { AuthBase } from '../../auth-base'
import { Avatar, type AvatarDTO } from './avatar'

export type AvatarRow = AvatarDTO & { version: number }

export class Avatar_Repository extends TableRepository<Avatar, AvatarRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: people belong to no tenant, and their picture goes with them everywhere.
    super(base, base.store.table<AvatarRow>('avatar'), { scope: 'none' })
  }

  protected toEntity(row: AvatarRow): Avatar {
    return Avatar.fromDTO(row)
  }

  /** Someone's picture: the last one that was accepted. */
  async latestReady(userId: string): Promise<Avatar | undefined> {
    const [latest] = await this.find({ userId, status: 'ready' }, { orderBy: [{ field: 'id', direction: 'desc' }], limit: 1 })
    return latest
  }
}
