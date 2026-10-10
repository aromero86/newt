import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { SessionToken } from './value-objects/session-token'

// Not part of the contract: a session is only ever seen as "who is signed in".
const SessionEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.string(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type SessionEntityDTO = z.infer<typeof SessionEntitySchema>

/** A signed-in browser. The browser holds the token; the database only its hash. */
export class Session extends Entity<typeof SessionEntitySchema> {

  private constructor(input: EntityInput<SessionEntityDTO>, isNew: boolean) {
    super(SessionEntitySchema, input, isNew)
  }

  static fromDTO(dto: SessionEntityDTO): Session {
    return new Session(dto, false)
  }

  /** A new session for `userId`, and the token only its browser will hold. */
  static open(userId: string, days: number): { session: Session, token: SessionToken } {
    const token = SessionToken.generate()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    return { session: new Session({ userId, tokenHash: SessionToken.hash(token), expiresAt }, true), token }
  }

  get userId(): string {
    return this.data.userId
  }

  isExpired(now = new Date()): boolean {
    return new Date(this.data.expiresAt) <= now
  }
}
