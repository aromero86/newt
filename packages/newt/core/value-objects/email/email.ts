import { z } from 'zod'
import type { ValueObject } from '../value-object'
import { InvalidEmail } from './errors/invalid-email'

const MAX_LENGTH = 254

/**
 * An email address, trimmed and in lower case: Lucia@Acme.dev and lucia@acme.dev are
 * one address. A string at runtime; to the compiler, only one that went through
 * `Email.from` or `Email.schema` is an `Email`.
 */
export type Email = string & z.$brand<'Email'>

export const Email = {

  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.email().max(MAX_LENGTH).refine(email => email === email.toLowerCase(), 'An email is kept in lower case').brand<'Email'>(),

  from(value: string): Email {
    const email = value.trim().toLowerCase()
    if (!z.email().max(MAX_LENGTH).safeParse(email).success) throw new InvalidEmail(value)
    return email as Email
  },

} satisfies ValueObject<Email, string>
