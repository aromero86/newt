import { z } from 'zod'
import type { ValueObject } from '../../../core/value-objects/value-object'

/** What the browser keeps in its cookie: 32 random bytes in base64url. */
export type SessionToken = string

export const SessionToken = {

  schema: z.string().regex(/^[A-Za-z0-9_-]{43}$/),

  from(value: string): SessionToken {
    return SessionToken.schema.parse(value)
  },

  /** A new, unguessable token. */
  generate(): SessionToken {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  },

  /** What the database keeps of a token: a copy of the database opens no session. */
  hash(token: SessionToken): string {
    return new Bun.CryptoHasher('sha256').update(token).digest('hex')
  },

} satisfies ValueObject<SessionToken, string> & { generate(): SessionToken, hash(token: SessionToken): string }
