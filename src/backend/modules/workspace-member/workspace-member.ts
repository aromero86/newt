import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { WorkspaceMemberRoleSchema, type WorkspaceMemberRole } from './workspace-member.schema'

// The row behind a member. The contract shows it joined with the user's profile.
const WorkspaceMemberEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  userId: z.uuidv7(),
  role: WorkspaceMemberRoleSchema,
  active: z.boolean(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type WorkspaceMemberEntityDTO = z.infer<typeof WorkspaceMemberEntitySchema>

/** A person's place in a workspace. */
export class WorkspaceMember extends Entity<typeof WorkspaceMemberEntitySchema> {

  private constructor(input: EntityInput<WorkspaceMemberEntityDTO>, isNew: boolean) {
    super(WorkspaceMemberEntitySchema, input, isNew)
  }

  static fromDTO(dto: WorkspaceMemberEntityDTO): WorkspaceMember {
    return new WorkspaceMember(dto, false)
  }

  static join(workspaceId: string, userId: string, role: WorkspaceMemberRole): WorkspaceMember {
    return new WorkspaceMember({ workspaceId, userId, role, active: true }, true)
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get userId(): string {
    return this.data.userId
  }

  get role(): WorkspaceMemberRole {
    return this.data.role
  }

  get active(): boolean {
    return this.data.active
  }

  get isActiveAdmin(): boolean {
    return this.data.active && this.data.role === 'admin'
  }

  /** Back in, with this role: someone who left can be added again. */
  rejoin(role: WorkspaceMemberRole): void {
    this.change({ active: true, role })
  }

  /** Out of the workspace, but still the author of what they did there. */
  leave(): void {
    this.change({ active: false })
  }

  changeRole(role: WorkspaceMemberRole): void {
    this.change({ role })
  }
}
