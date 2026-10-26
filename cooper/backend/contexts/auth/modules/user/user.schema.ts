import { z } from 'zod'
import { defineFilter, Email } from 'newt/contract'

/** An account, as anyone sees it: never its password, nor its hash. */
export const UserSchema = z.object({
  id: z.uuidv7(),
  /** One account per email, whatever its case: kept in lower case. */
  email: Email.schema,
  name: z.string().trim().min(1, 'Write your name').max(80, 'Use at most 80 characters'),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** A password as it is chosen: long enough, never so long that hashing it is a cost. */
export const UserPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters')

/** A new account: the email as typed (it is kept in lower case), a name and a password. */
export const UserSignUpSchema = z.object({
  email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
  name: UserSchema.shape.name,
  password: UserPasswordSchema,
})

/** What the staff may look accounts up by: these fields, these operators, nothing else. */
export const UserFilter = defineFilter({
  email: { field: 'email', value: z.string(), ops: ['eq', 'ieq'] },
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  signedUp: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })

export type UserDTO = z.infer<typeof UserSchema>
export type UserSignUpDTO = z.input<typeof UserSignUpSchema>
/** A search of accounts as a client sends it. */
export type UserFilterDTO = z.infer<typeof UserFilter.schema>
