import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { Email } from '../../core/value-objects/email/email'
import { WorkspaceInvitation_Created } from './events/workspace-invitation-created'

// The row behind an invitation. The contract shows it with who invited.
const WorkspaceInvitationEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  email: Email.schema,
  invitedBy: z.uuidv7(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type WorkspaceInvitationEntityDTO = z.infer<typeof WorkspaceInvitationEntitySchema>

/** An invitation to a workspace for an email with no account yet. */
export class WorkspaceInvitation extends Entity<typeof WorkspaceInvitationEntitySchema> {

  private constructor(input: EntityInput<WorkspaceInvitationEntityDTO>, isNew: boolean) {
    super(WorkspaceInvitationEntitySchema, input, isNew)
  }

  static fromDTO(dto: WorkspaceInvitationEntityDTO): WorkspaceInvitation {
    return new WorkspaceInvitation(dto, false)
  }

  static create(
    input: { workspaceId: string, workspaceName: string, email: string, invitedBy: { id: string, fullName: string } },
    days: number,
  ): WorkspaceInvitation {
    const email = Email.from(input.email)
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const invitation = new WorkspaceInvitation(
      { workspaceId: input.workspaceId, email, invitedBy: input.invitedBy.id, expiresAt, acceptedAt: null, cancelledAt: null },
      true,
    )
    invitation.trackEvent(new WorkspaceInvitation_Created({ email, workspaceName: input.workspaceName, inviterFullName: input.invitedBy.fullName, expiresAt }))
    return invitation
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get invitedBy(): string {
    return this.data.invitedBy
  }

  isPending(now = new Date()): boolean {
    return this.data.acceptedAt === null && this.data.cancelledAt === null && new Date(this.data.expiresAt) > now
  }

  accept(): void {
    this.change({ acceptedAt: new Date().toISOString() })
  }

  cancel(): void {
    this.change({ cancelledAt: new Date().toISOString() })
  }
}
