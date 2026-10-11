import { z } from 'zod'

export const AuthTokenModuleName = 'authToken'

/** An access token, as its owner sees it: never the secret, which is shown once. */
export const AuthTokenSchema = z.object({
  id: z.uuidv7(),
  /** What it is for, such as the assistant it connects: "Claude Code on my laptop". */
  name: z.string(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const AuthTokenCreateSchema = z.object({
  name: z.string().trim().min(1, 'Say what it is for').max(80, 'Keep it under 80 characters'),
})

/** A new token and its secret: the only time the secret is seen. */
export const AuthTokenCreatedSchema = z.object({ token: AuthTokenSchema, secret: z.string() })

export type AuthTokenDTO = z.infer<typeof AuthTokenSchema>
export type AuthTokenCreateDTO = z.infer<typeof AuthTokenCreateSchema>
export type AuthTokenCreatedDTO = z.infer<typeof AuthTokenCreatedSchema>
