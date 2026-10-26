import { z } from 'zod'
import type { ValueObject } from '../value-object'
import { InvalidSecretToken } from './errors/invalid-secret-token'

/**
 * An unguessable token handed to one person: a session cookie, a password reset
 * link. 32 random bytes in base64url. The database keeps only its hash, so a copy
 * of the database opens nothing. Branded: a string from a cookie or a link is a
 * `SecretToken` only once `SecretToken.from` checked it.
 */
export type SecretToken = string & z.$brand<'SecretToken'>

export const SecretToken = {

  schema: z.string().regex(/^[A-Za-z0-9_-]{43}$/).brand<'SecretToken'>(),

  /** The token, checked: `InvalidSecretToken` (a 400) for anything that is not one. */
  from(value: string): SecretToken {
    const parsed = SecretToken.schema.safeParse(value)
    if (!parsed.success) throw new InvalidSecretToken()
    return parsed.data
  },

  generate(): SecretToken {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') as SecretToken
  },

  /** What the database keeps of a token. */
  hash(token: SecretToken): string {
    return new Bun.CryptoHasher('sha256').update(token).digest('hex')
  },

} satisfies ValueObject<SecretToken, string> & { generate(): SecretToken, hash(token: SecretToken): string }
