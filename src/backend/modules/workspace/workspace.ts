import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { WorkspaceArchived } from './errors/workspace-archived'
import { WorkspaceSchema, type WorkspaceDTO } from './workspace.schema'

export * from './workspace.schema'

export class Workspace extends Entity<typeof WorkspaceSchema> {

  private constructor(input: EntityInput<WorkspaceDTO>, isNew: boolean) {
    super(WorkspaceSchema, input, isNew)
  }

  static fromDTO(dto: WorkspaceDTO): Workspace {
    return new Workspace(dto, false)
  }

  static create(input: { name: string, description: string, createdBy: string }): Workspace {
    return new Workspace({ ...input, archivedAt: null }, true)
  }

  get isArchived(): boolean {
    return this.data.archivedAt !== null
  }

  /** An archived workspace is read only. */
  update(changes: Partial<Pick<WorkspaceDTO, 'name' | 'description'>>): void {
    if (this.isArchived) throw new WorkspaceArchived()
    this.change(changes)
  }

  archive(): void {
    if (!this.isArchived) this.change({ archivedAt: new Date().toISOString() })
  }

  unarchive(): void {
    this.change({ archivedAt: null })
  }
}
