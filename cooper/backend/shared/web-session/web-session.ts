import { z } from 'zod'
import { Entity, now, SecretToken, type EntityInput } from 'newt/core'

const WebSessionSchema = z.object({
  id: z.uuidv7(),
  /** auth's user, as the token traded at sign-in said. */
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type WebSessionDTO = z.infer<typeof WebSessionSchema>

/**
 * A browser signed in to one context of cooper: the context's own, on its own origin,
 * opened once auth said who the person is. The browser holds the token; the store
 * only its hash.
 */
export class WebSession extends Entity<typeof WebSessionSchema> {

  private constructor(input: EntityInput<WebSessionDTO>, isNew: boolean) {
    super(WebSessionSchema, input, isNew)
  }

  static fromDTO(dto: WebSessionDTO & { version: number }): WebSession {
    return new WebSession(dto, false)
  }

  static open(userId: string, days: number): { session: WebSession, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(now().getTime() + days * 24 * 60 * 60_000).toISOString()
    return { session: new WebSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  get userId(): string {
    return this.data.userId
  }

  isExpired(at = now()): boolean {
    return new Date(this.data.expiresAt) <= at
  }

  /** Signed out, or expired: its row goes. */
  close(): void {
    this.markAsDeleted()
  }
}
