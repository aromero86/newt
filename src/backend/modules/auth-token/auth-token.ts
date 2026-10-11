import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { SecretToken } from '../../core/value-objects/secret-token/secret-token'

export * from './auth-token.schema'

const AuthTokenEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  name: z.string(),
  tokenHash: z.string().min(1),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type AuthTokenEntityDTO = z.infer<typeof AuthTokenEntitySchema>

/** What a secret starts with, so that people and secret scanners recognize it. */
const PREFIX = 'newt_'

/**
 * An access token: how an AI assistant, or anything outside the browser, acts for
 * a person. The person holds the secret; the database only its hash.
 */
export class AuthToken extends Entity<typeof AuthTokenEntitySchema> {

  private constructor(input: EntityInput<AuthTokenEntityDTO>, isNew: boolean) {
    super(AuthTokenEntitySchema, input, isNew)
  }

  static fromDTO(dto: AuthTokenEntityDTO): AuthToken {
    return new AuthToken(dto, false)
  }

  /** A new token for `userId`, and the secret only its owner will hold. */
  static create(userId: string, name: string): { token: AuthToken, secret: string } {
    const secret = SecretToken.generate()
    return { token: new AuthToken({ userId, name, tokenHash: SecretToken.hash(secret), lastUsedAt: null }, true), secret: `${PREFIX}${secret}` }
  }

  /** What the database keeps of a secret; null when it cannot be one. */
  static hashOf(secret: string): string | null {
    const token = secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : ''
    return SecretToken.schema.safeParse(token).success ? SecretToken.hash(token) : null
  }

  get userId(): string {
    return this.data.userId
  }

  used(): void {
    this.change({ lastUsedAt: new Date().toISOString() })
  }
}
