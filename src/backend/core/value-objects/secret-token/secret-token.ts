import { z } from 'zod'
import type { ValueObject } from '../value-object'

/**
 * An unguessable token handed to one person: a session cookie, a password reset
 * link. 32 random bytes in base64url. The database keeps only its hash, so a copy
 * of the database opens nothing.
 */
export type SecretToken = string

export const SecretToken = {

  schema: z.string().regex(/^[A-Za-z0-9_-]{43}$/),

  from(value: string): SecretToken {
    return SecretToken.schema.parse(value)
  },

  generate(): SecretToken {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  },

  /** What the database keeps of a token. */
  hash(token: SecretToken): string {
    return new Bun.CryptoHasher('sha256').update(token).digest('hex')
  },

} satisfies ValueObject<SecretToken, string> & { generate(): SecretToken, hash(token: SecretToken): string }
