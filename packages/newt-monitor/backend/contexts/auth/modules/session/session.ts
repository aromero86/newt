import { Entity, now, SecretToken, type EntityInput } from 'newt-kit/core'
import { SessionSchema, type SessionDTO } from './session.schema'

export * from './session.schema'

/** A browser signed in to the monitor, until it signs out or its time is up. */
export class Session extends Entity<typeof SessionSchema> {

  private constructor(input: EntityInput<SessionDTO>, isNew: boolean) {
    super(SessionSchema, input, isNew)
  }

  static fromDTO(dto: SessionDTO & { version: number }): Session {
    return new Session(dto, false)
  }

  /** A new session, for `hours`: its token, which only the browser keeps, and the session that keeps its hash. */
  static open(hours: number): { session: Session, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(now().getTime() + hours * 60 * 60_000).toISOString()
    return { session: new Session({ tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  isExpired(at = now()): boolean {
    return new Date(this.data.expiresAt) <= at
  }

  /** Signed out, or expired: its row goes. */
  close(): void {
    this.markAsDeleted()
  }
}
