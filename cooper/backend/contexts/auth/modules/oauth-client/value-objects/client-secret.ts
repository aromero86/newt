import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { ValueObject } from '@newt-kit/newt/core'
import { InvalidClientSecret } from '../errors/invalid-client-secret'

/**
 * The secret a confidential OAuth client proves itself with at the token endpoint
 * (`client_secret`): a product's web app, which keeps it on its server. At least 24
 * characters. The store keeps only its hash, compared in constant time.
 */
export type ClientSecret = string & z.$brand<'ClientSecret'>

const hashOf = (secret: string) => new Bun.CryptoHasher('sha256').update(secret).digest('hex')

export const ClientSecret = {

  schema: z.string().min(24).max(200).brand<'ClientSecret'>(),

  from(value: string): ClientSecret {
    const parsed = ClientSecret.schema.safeParse(value)
    if (!parsed.success) throw new InvalidClientSecret()
    return parsed.data
  },

  /** What the store keeps of it. */
  hash(secret: ClientSecret): string {
    return hashOf(secret)
  },

  /** Whether `presented` is the secret of this hash, in constant time: how long it takes says nothing. */
  matches(presented: string, hash: string): boolean {
    return timingSafeEqual(Buffer.from(hashOf(presented), 'hex'), Buffer.from(hash, 'hex'))
  },

} satisfies ValueObject<ClientSecret, string> & { hash(secret: ClientSecret): string, matches(presented: string, hash: string): boolean }
