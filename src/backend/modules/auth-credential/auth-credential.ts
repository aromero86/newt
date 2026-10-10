import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { AuthCredential_Changed } from './events/auth-credential-changed'

// Not part of the contract: a password hash never leaves the module.
const AuthCredentialEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  passwordHash: z.string().min(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type AuthCredentialEntityDTO = z.infer<typeof AuthCredentialEntitySchema>

/** A user's password, hashed. */
export class AuthCredential extends Entity<typeof AuthCredentialEntitySchema> {

  private constructor(input: EntityInput<AuthCredentialEntityDTO>, isNew: boolean) {
    super(AuthCredentialEntitySchema, input, isNew)
  }

  static fromDTO(dto: AuthCredentialEntityDTO): AuthCredential {
    return new AuthCredential(dto, false)
  }

  static async create(userId: string, password: string): Promise<AuthCredential> {
    return new AuthCredential({ userId, passwordHash: await Bun.password.hash(password) }, true)
  }

  get userId(): string {
    return this.data.userId
  }

  verify(password: string): Promise<boolean> {
    return Bun.password.verify(password, this.data.passwordHash)
  }

  /** A new password, set from `sessionId` (or from no session): whoever reacts knows which. */
  async replace(password: string, sessionId: string | null): Promise<void> {
    this.change({ passwordHash: await Bun.password.hash(password) })
    this.trackEvent(new AuthCredential_Changed({ userId: this.data.userId, sessionId }))
  }
}
