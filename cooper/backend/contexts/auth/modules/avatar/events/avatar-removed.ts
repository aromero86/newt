import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { AvatarDTO } from '../avatar.schema'

/** A picture is gone: refused, replaced, or never finished. */
export class Avatar_Removed implements DomainEvent<AvatarDTO> {
  static readonly eventName = 'avatar.removed'
  readonly name = Avatar_Removed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AvatarDTO) {}
}
