import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { UserDTO } from '../user.schema'

/** Someone made an account: who they are, never their password. */
export class User_SignedUp implements DomainEvent<UserDTO> {
  static readonly eventName = 'user.signedUp'
  readonly name = User_SignedUp.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: UserDTO) {}
}
