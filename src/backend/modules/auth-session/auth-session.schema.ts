import { z } from 'zod'
import { AuthCredentialPasswordSchema } from '../auth-credential/auth-credential.schema'
import { UserCreateSchema } from '../user/user.schema'

export const AuthSessionModuleName = 'authSession'

/** A new account: the user's profile and their first password. */
export const AuthSessionSignUpSchema = UserCreateSchema.extend({ password: AuthCredentialPasswordSchema })

/** `login` is the nick or the email. */
export const AuthSessionSignInSchema = z.object({
  login: z.string().trim().min(1, 'Write your nick or email'),
  password: z.string().min(1, 'Write your password'),
})

export type AuthSessionSignUpDTO = z.input<typeof AuthSessionSignUpSchema>
export type AuthSessionSignInDTO = z.infer<typeof AuthSessionSignInSchema>
