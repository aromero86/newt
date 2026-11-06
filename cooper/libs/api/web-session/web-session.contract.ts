import { z } from 'zod'

// The session is each web app's own (a BFF client of auth): its routes are the web
// session's (`cooper/backend/shared/web-session`), and what `GET /api/session` tells
// of the signed-in person each context says in its own code, its `profile`, with no
// schema of its own. This is the contract boards' and the backoffice's keep.

/** Who is signed in, as boards tells its web app. */
export const SessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  /** Where their picture is read from, for the apps that show it. */
  avatarUrl: z.string().nullable().optional(),
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
