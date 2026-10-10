import { z } from 'zod'
import { AuthCredentialPasswordSchema } from '../auth-credential/auth-credential.schema'

export const AuthPasswordResetModuleName = 'authPasswordReset'

export const AuthPasswordResetRequestSchema = z.object({
  email: z.email('Write a valid email'),
})

export const AuthPasswordResetCompleteSchema = z.object({
  token: z.string().min(1),
  password: AuthCredentialPasswordSchema,
})

export type AuthPasswordResetRequestDTO = z.infer<typeof AuthPasswordResetRequestSchema>
export type AuthPasswordResetCompleteDTO = z.infer<typeof AuthPasswordResetCompleteSchema>

/** What the email needs. The token travels only in memory, from the request to the email. */
export type AuthPasswordResetRequestedPayload = {
  userId: string
  email: string
  fullName: string
  token: string
  expiresAt: string
}
