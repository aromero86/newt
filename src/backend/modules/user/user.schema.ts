import { z } from 'zod'
import { Email } from '../../core/value-objects/email/email'

export const UserModuleName = 'user'

/** Letters, numbers and single hyphens inside, up to 39 characters: as on GitHub. */
export const UserNickSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, 'Use letters, numbers and single hyphens, up to 39 characters')

export const UserSchema = z.object({
  id: z.uuidv7(),
  nick: UserNickSchema,
  fullName: z.string().trim().min(1, 'Write your name').max(100),
  email: Email.schema,
  bio: z.string().max(500, 'Keep it under 500 characters'),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** As typed: the email in any case, which `Email` normalizes. */
const UserEmailInputSchema = z.email('Write a valid email').max(254)

export const UserCreateSchema = UserSchema.pick({ nick: true, fullName: true }).extend({
  email: UserEmailInputSchema,
  bio: UserSchema.shape.bio.default(''),
})
export const UserUpdateSchema = UserSchema.pick({ nick: true, fullName: true, bio: true }).extend({ email: UserEmailInputSchema }).partial()

export type UserDTO = z.infer<typeof UserSchema>
export type UserCreateDTO = z.input<typeof UserCreateSchema>
export type UserUpdateDTO = z.infer<typeof UserUpdateSchema>
