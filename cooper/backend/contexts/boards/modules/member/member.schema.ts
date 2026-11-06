import { Email } from '@newt-kit/newt/contract'
import { z } from 'zod'

/** Someone who belongs to a workspace, as `boards` sees them: who they are, and where to write to them. auth keeps them. */
export const MemberSchema = z.object({
  /** Their user's id, in auth. */
  id: z.string(),
  name: z.string(),
  email: Email.schema,
  /** Where their picture is read from, if they have one. */
  avatarUrl: z.string().nullable(),
})

export type MemberDTO = z.infer<typeof MemberSchema>
