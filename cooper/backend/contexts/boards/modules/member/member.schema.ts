import { Email } from 'newt-kit/contract'
import { z } from 'zod'

/** Someone who belongs to a workspace, as `boards` sees them: who they are, and where to write to them. auth keeps them. */
export const MemberSchema = z.object({
  /** Their user's id, in auth. */
  id: z.string(),
  name: z.string(),
  email: Email.schema,
})

export type MemberDTO = z.infer<typeof MemberSchema>
