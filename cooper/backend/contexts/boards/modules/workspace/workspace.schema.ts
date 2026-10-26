import { Email } from 'newt/core'
import { z } from 'zod'
import type { BoardDTO } from '../board/board.schema'
import type { CardDTO } from '../card/card.schema'
import type { ColumnDTO } from '../column/column.schema'

/** A board as its screen shows it: the board, its columns from left to right, and their cards from the top. */
export type BoardViewDTO = {
  board: BoardDTO
  columns: ColumnDTO[]
  cards: CardDTO[]
}

/** The board every new workspace starts with. */
export const WELCOME_BOARD = {
  name: 'Welcome',
  description: 'A first board to find your way around: move the card, add your own.',
  columns: ['To do', 'Doing', 'Done'],
  card: {
    title: 'Welcome to Cooper',
    description: 'Drag this card to Doing, then to Done. Add columns and cards of your own, and assign them to the people of your workspace.',
  },
} as const

/*
 * Workspaces, their members and their invitations are auth's (its tenants, accesses
 * and invitations). boards' UI manages them through boards' own origin, and these are
 * the shapes boards' routes answer with: auth's, in boards' words.
 */

/** A workspace, as the signed-in person sees it: whether they are its admin (who made it; there is one). */
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Its admin's user id, in auth. */
  adminId: z.string(),
  /** Whether the signed-in person is its admin: who renames it, deletes it, invites and removes. */
  isAdmin: z.boolean(),
  createdAt: z.string(),
})

/** Someone who belongs to a workspace, as its members' screen shows them. */
export const WorkspaceMemberSchema = z.object({
  /** Their user id, in auth: what a card's assignee is. */
  id: z.string(),
  name: z.string(),
  email: Email.schema,
  isAdmin: z.boolean(),
})

/** An invitation to a workspace still waiting, as its admin sees it. */
export const WorkspaceInvitationSchema = z.object({
  id: z.string(),
  email: Email.schema,
  status: z.enum(['pending', 'accepted', 'revoked']),
  createdAt: z.string(),
  expiresAt: z.string(),
})

/** What an invitation's link shows, to anyone who has it, before it is accepted. */
export const InvitationReviewSchema = z.object({
  workspaceName: z.string(),
  /** Who may accept it: whoever signs in with this email. */
  email: Email.schema,
  /** The name of who invited them. */
  invitedBy: z.string(),
})

export type WorkspaceDTO = z.infer<typeof WorkspaceSchema>
export type WorkspaceMemberDTO = z.infer<typeof WorkspaceMemberSchema>
export type WorkspaceInvitationDTO = z.infer<typeof WorkspaceInvitationSchema>
export type InvitationReviewDTO = z.infer<typeof InvitationReviewSchema>

/** A tenant of auth as a workspace of boards, for whoever is looking at it. */
export function workspaceOf(tenant: { id: string, name: string, createdBy: string, createdAt: string }, userId: string): WorkspaceDTO {
  return { id: tenant.id, name: tenant.name, adminId: tenant.createdBy, isAdmin: tenant.createdBy === userId, createdAt: tenant.createdAt }
}

/** An invitation of auth as its workspace's admin sees it: never who accepted it. */
export function workspaceInvitationOf(invitation: WorkspaceInvitationDTO): WorkspaceInvitationDTO {
  const { id, email, status, createdAt, expiresAt } = invitation
  return { id, email, status, createdAt, expiresAt }
}
