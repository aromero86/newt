import { z } from 'zod'

/** A browser signed in to the monitor: it holds the token, the store only its hash. */
export const SessionSchema = z.object({
  id: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What signing in sends. */
export const SignInSchema = z.object({
  user: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
})

export type SessionDTO = z.infer<typeof SessionSchema>
export type SignInDTO = z.input<typeof SignInSchema>

/** Who is signed in: what `GET /api/session` answers. */
export type MeDTO = { user: string }

/** The cookie that keeps the session's token: the page's scripts cannot read it. */
export const SESSION_COOKIE = 'newt_monitor_session'
