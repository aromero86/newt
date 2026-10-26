import { z } from 'zod'
import { UserSignUpSchema } from '../user/user.schema'

/**
 * The cookie of a session of auth. Named after auth, not `session`: on one host in
 * development (localhost, whatever the port) the cookies of every context meet.
 */
export const SessionCookie = 'cooper_auth_session'

/** A new account, signed in at once; on the way to a product, the product it is for. */
export const SessionSignUpSchema = UserSignUpSchema.extend({
  /** The product that sent the person here: only one that takes new accounts makes one. */
  productId: z.string().optional(),
})

export const SessionSignInSchema = z.object({
  email: z.string().trim().min(1, 'Write your email'),
  password: z.string().min(1, 'Write your password'),
})

export type SessionSignUpDTO = z.input<typeof SessionSignUpSchema>
export type SessionSignInDTO = z.infer<typeof SessionSignInSchema>
