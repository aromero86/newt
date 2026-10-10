import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { SecretToken } from '../../core/value-objects/secret-token/secret-token'
import { AuthPasswordReset_Requested } from './events/auth-password-reset-requested'

// Not part of the contract: a reset is only ever seen as an email and a link.
const AuthPasswordResetEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type AuthPasswordResetEntityDTO = z.infer<typeof AuthPasswordResetEntitySchema>

/** A request to reset a password, answered with a link that works once and for a while. */
export class AuthPasswordReset extends Entity<typeof AuthPasswordResetEntitySchema> {

  private constructor(input: EntityInput<AuthPasswordResetEntityDTO>, isNew: boolean) {
    super(AuthPasswordResetEntitySchema, input, isNew)
  }

  static fromDTO(dto: AuthPasswordResetEntityDTO): AuthPasswordReset {
    return new AuthPasswordReset(dto, false)
  }

  /** A new request for `user`: its link lasts `minutes`. */
  static request(user: { id: string, email: string, fullName: string }, minutes: number): AuthPasswordReset {
    const token = SecretToken.generate()
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    const reset = new AuthPasswordReset({ userId: user.id, tokenHash: SecretToken.hash(token), expiresAt, usedAt: null, cancelledAt: null }, true)
    reset.trackEvent(new AuthPasswordReset_Requested({ userId: user.id, email: user.email, fullName: user.fullName, token, expiresAt }))
    return reset
  }

  get userId(): string {
    return this.data.userId
  }

  isUsable(now = new Date()): boolean {
    return this.data.usedAt === null && this.data.cancelledAt === null && new Date(this.data.expiresAt) > now
  }

  use(): void {
    this.change({ usedAt: new Date().toISOString() })
  }

  /** A newer request replaces this one. */
  cancel(): void {
    this.change({ cancelledAt: new Date().toISOString() })
  }
}
