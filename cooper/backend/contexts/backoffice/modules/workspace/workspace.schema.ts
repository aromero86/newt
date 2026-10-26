import { z } from 'zod'
import type { AccessRole } from '../../../auth/modules/access/access.schema'
import type { TenantDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { BoardDTO } from '../../../boards/modules/board/board.schema'
import type { PersonDTO } from '../user/user.schema'

/** How the staff look workspaces up: by their name, whole, whatever its case. */
export const WorkspaceSearchSchema = z.object({
  name: z.string().trim().max(60).optional(),
})

/** A workspace in the staff's list: who its admin is, and how many cards it holds. */
export type WorkspaceSummaryDTO = Pick<TenantDTO, 'id' | 'name' | 'createdAt'> & {
  /** Null only for an account gone since. */
  admin: PersonDTO | null
  cards: number
}

/** A workspace on its own page: its summary, and how many members and boards it has. */
export type WorkspaceDetailDTO = WorkspaceSummaryDTO & {
  members: number
  boards: number
}

/** Someone of a workspace: its `id` is their access's, by which the list goes page after page. */
export type WorkspaceMemberDTO = PersonDTO & {
  id: string
  userId: string
  role: AccessRole
  since: string
}

/** A board of a workspace, with how many cards it has. */
export type WorkspaceBoardDTO = Pick<BoardDTO, 'id' | 'name' | 'description' | 'createdAt'> & {
  cards: number
}

/** A board just created, in whatever workspace, with its workspace's name. */
export type RecentBoardDTO = Pick<BoardDTO, 'id' | 'name' | 'workspaceId' | 'createdAt'> & {
  /** Null only for a workspace deleted since. */
  workspaceName: string | null
}

export type WorkspaceSearchDTO = z.input<typeof WorkspaceSearchSchema>
