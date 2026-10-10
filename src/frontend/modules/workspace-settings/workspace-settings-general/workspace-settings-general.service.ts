import { WorkspaceApi, WorkspaceUpdateSchema, type WorkspaceMineDTO } from '@newt/api/workspace'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'

// Both fields are sent: the form always shows them.
const GeneralSchema = WorkspaceUpdateSchema.required().extend({ description: z.string().max(500, 'Keep it under 500 characters') })

/** A workspace's name and description, and archiving it. Admins only. */
export class WorkspaceSettingsGeneralService {

  private readonly api = inject(WorkspaceApi)
  private readonly workspaces = inject(WorkspacesService)
  private workspaceId = ''

  readonly form = new FormStore(GeneralSchema, { name: '', description: '' }, {
    errorFields: { 'workspace.name_taken': 'name', 'workspace.archived': 'name' },
  })

  /** Starts editing this workspace. */
  edit(workspace: WorkspaceMineDTO): void {
    this.workspaceId = workspace.id
    this.form.reset({ name: workspace.name, description: workspace.description })
  }

  async save(): Promise<void> {
    if (await this.form.submit(async changes => this.workspaces.replace(await this.api.update(this.workspaceId, changes)))) {
      toast.success('Workspace saved')
    }
  }

  async archive(): Promise<void> {
    this.workspaces.replace(await this.api.archive(this.workspaceId))
    toast.success('Workspace archived: it is read only until you unarchive it')
  }

  async unarchive(): Promise<void> {
    this.workspaces.replace(await this.api.unarchive(this.workspaceId))
    toast.success('Workspace unarchived')
  }
}
