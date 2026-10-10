import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { SecretToken } from '../../core/value-objects/secret-token/secret-token'

// Not part of the contract: a session is only ever seen as "who is signed in".
const AuthSessionEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.string(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type AuthSessionEntityDTO = z.infer<typeof AuthSessionEntitySchema>

/** A signed-in browser. The browser holds the token; the database only its hash. */
export class AuthSession extends Entity<typeof AuthSessionEntitySchema> {

  private constructor(input: EntityInput<AuthSessionEntityDTO>, isNew: boolean) {
    super(AuthSessionEntitySchema, input, isNew)
  }

  static fromDTO(dto: AuthSessionEntityDTO): AuthSession {
    return new AuthSession(dto, false)
  }

  /** A new session for `userId`, and the token only its browser will hold. */
  static open(userId: string, days: number): { session: AuthSession, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    return { session: new AuthSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  get userId(): string {
    return this.data.userId
  }

  isExpired(now = new Date()): boolean {
    return new Date(this.data.expiresAt) <= now
  }
}
