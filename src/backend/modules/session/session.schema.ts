import { z } from 'zod'
import { CredentialPasswordSchema } from '../credential/credential.schema'
import { UserCreateSchema } from '../user/user.schema'

export const SessionModuleName = 'session'

/** A new account: the user's profile and their first password. */
export const SessionSignUpSchema = UserCreateSchema.extend({ password: CredentialPasswordSchema })

/** `login` is the nick or the email. */
export const SessionSignInSchema = z.object({
  login: z.string().trim().min(1, 'Write your nick or email'),
  password: z.string().min(1, 'Write your password'),
})

export type SessionSignUpDTO = z.input<typeof SessionSignUpSchema>
export type SessionSignInDTO = z.infer<typeof SessionSignInSchema>
