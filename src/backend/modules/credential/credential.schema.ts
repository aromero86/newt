import { z } from 'zod'

export const CredentialModuleName = 'credential'

export const CredentialPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(128)

export const CredentialChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Write your current password'),
  newPassword: CredentialPasswordSchema,
})

export type CredentialChangeDTO = z.infer<typeof CredentialChangeSchema>

/** Who changed their password, and from which session: the others are closed. */
export type CredentialChangedPayload = { userId: string, sessionId: string }
