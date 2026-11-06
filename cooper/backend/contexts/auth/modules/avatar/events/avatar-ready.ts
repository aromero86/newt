import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { AvatarDTO } from '../avatar.schema'

/** Someone has a new picture. */
export class Avatar_Ready implements DomainEvent<AvatarDTO> {
  static readonly eventName = 'avatar.ready'
  readonly name = Avatar_Ready.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AvatarDTO) {}
}
