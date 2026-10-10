import { z } from 'zod'
import type { ValueObject } from '../value-object'
import { InvalidEmail } from './errors/invalid-email'

const MAX_LENGTH = 254

/** An email address, trimmed and in lower case: Lucia@Acme.dev and lucia@acme.dev are one address. */
export type Email = string

export const Email = {

  schema: z.email('Write a valid email').max(MAX_LENGTH).refine(email => email === email.toLowerCase(), 'An email is kept in lower case'),

  from(value: string): Email {
    const email = value.trim().toLowerCase()
    if (!z.email().max(MAX_LENGTH).safeParse(email).success) throw new InvalidEmail(value)
    return email
  },

} satisfies ValueObject<Email, string>
