import { z } from 'zod'

// No backend schema yet: the session is boards' own (a BFF client of auth), and its
// routes arrive when boards is wired to auth. This is the contract they keep.

/** Who is signed in, as boards tells its web app. */
export const SessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

/** `GET /api/session`: the signed-in person, or a 401 without a session. */
export const SessionSchema = z.object({
  user: SessionUserSchema,
})

/** `POST /api/session/sign-out`: where the browser goes next, auth, to sign out there too; it comes back after. */
export const SessionSignOutSchema = z.object({
  next: z.string(),
})

export type SessionUserDTO = z.infer<typeof SessionUserSchema>
export type SessionDTO = z.infer<typeof SessionSchema>
export type SessionSignOutDTO = z.infer<typeof SessionSignOutSchema>
