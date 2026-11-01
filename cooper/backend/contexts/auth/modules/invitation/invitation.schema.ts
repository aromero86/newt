import { z } from 'zod'
import { Email } from 'newt-kit/contract'

export const InvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked'])

/** Someone asked to join a workspace, by email, by its admin. */
export const InvitationSchema = z.object({
  id: z.uuidv7(),
  tenantId: z.uuidv7(),
  /** Who may accept it: whoever signs in with this email. */
  email: Email.schema,
  invitedBy: z.uuidv7(),
  status: InvitationStatusSchema,
  /** Who accepted it, once someone did. */
  acceptedBy: z.uuidv7().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const InvitationCreateSchema = z.object({
  email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
})

/** What the person who opens an invitation's link is shown before accepting it. */
export const InvitationReviewSchema = z.object({
  tenantId: z.uuidv7(),
  tenantName: z.string(),
  email: Email.schema,
  invitedByName: z.string(),
  /** Pending and not expired: it can still be accepted. */
  open: z.boolean(),
})

export type InvitationStatus = z.infer<typeof InvitationStatusSchema>
export type InvitationDTO = z.infer<typeof InvitationSchema>
export type InvitationCreateDTO = z.input<typeof InvitationCreateSchema>
export type InvitationReviewDTO = z.infer<typeof InvitationReviewSchema>
