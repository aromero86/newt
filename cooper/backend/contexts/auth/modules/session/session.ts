import { z } from 'zod'
import { Entity, now, SecretToken, type EntityInput } from 'newt-kit/core'

/** Not part of the contract: a session is only ever seen as "who is signed in". */
const SessionEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type SessionEntityDTO = z.infer<typeof SessionEntitySchema>

/** A browser signed in to auth. The browser holds the token; the store only its hash. */
export class Session extends Entity<typeof SessionEntitySchema> {

  private constructor(input: EntityInput<SessionEntityDTO>, isNew: boolean) {
    super(SessionEntitySchema, input, isNew)
  }

  static fromDTO(dto: SessionEntityDTO & { version: number }): Session {
    return new Session(dto, false)
  }

  /** A new session for `userId`, and the token only its browser will hold. */
  static open(userId: string, days: number): { session: Session, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(now().getTime() + days * 24 * 60 * 60_000).toISOString()
    return { session: new Session({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  get userId(): string {
    return this.data.userId
  }

  isExpired(at = now()): boolean {
    return new Date(this.data.expiresAt) <= at
  }

  /** Signed out, or expired: a session is not history, its row goes. */
  close(): void {
    this.markAsDeleted()
  }
}
