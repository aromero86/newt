import { z } from 'zod'

export const AuthCredentialModuleName = 'authCredential'

export const AuthCredentialPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(128)

export const AuthCredentialChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Write your current password'),
  newPassword: AuthCredentialPasswordSchema,
})

export type AuthCredentialChangeDTO = z.infer<typeof AuthCredentialChangeSchema>

/**
 * Whose password changed, and from which session: the others are closed. `null`
 * when no session did it (a reset from an email link): then every session is.
 */
export type AuthCredentialChangedPayload = { userId: string, sessionId: string | null }
