import { z } from 'zod'
import type { AccessRole } from '../../../auth/modules/access/access.schema'
import type { UserDTO } from '../../../auth/modules/user/user.schema'

/** How the staff look accounts up: an email or a name, whole, whatever its case. */
export const UserSearchSchema = z.object({
  text: z.string().trim().max(254).optional(),
})

/** Who someone is, beside what the staff look at: a workspace's admin, a member. */
export type PersonDTO = Pick<UserDTO, 'id' | 'name' | 'email'>

/** An account in the staff's list: whether it is of the staff too. */
export type UserSummaryDTO = UserDTO & {
  staff: boolean
}

/** An account, as the staff see it: whether it is of the staff, and how many workspaces it is in. */
export type UserDetailDTO = UserDTO & {
  staff: boolean
  workspaces: number
}

/** A workspace someone belongs to: its `id` is their access's, by which the list goes page after page. */
export type UserWorkspaceDTO = {
  id: string
  workspaceId: string
  name: string
  role: AccessRole
  since: string
}

export type UserSearchDTO = z.input<typeof UserSearchSchema>
export type { UserDTO }
