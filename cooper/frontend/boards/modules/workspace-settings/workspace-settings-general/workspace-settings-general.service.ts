import { WorkspaceApi, WorkspaceRenameSchema, type WorkspaceDTO } from '@cooper/api/workspace'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'
import { toast } from '@cooper/ui/components/toast'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'

/** A workspace's name, and deleting it after asking. Its admin's only. */
export class WorkspaceSettingsGeneralService {

  private readonly api = inject(WorkspaceApi)
  private readonly workspaces = inject(WorkspacesService)
  private readonly store = new Store({ confirmingDelete: false, deleting: false })
  private workspace: WorkspaceDTO | null = null

  readonly confirmingDelete = this.store.select('confirmingDelete')
  readonly deleting = this.store.select('deleting')

  readonly form = new FormStore(WorkspaceRenameSchema, { name: '' }, {
    errorFields: { validation: 'name' },
  })

  /** Starts editing this workspace. */
  edit(workspace: WorkspaceDTO): void {
    this.workspace = workspace
    this.form.reset({ name: workspace.name })
  }

  async save(): Promise<void> {
    const workspace = this.workspace
    if (!workspace) return
    if (await this.form.submit(async input => this.workspaces.replace(await this.api.rename(workspace.id, input)))) {
      toast.success('Workspace renamed')
    }
  }

  askDelete(): void {
    this.store.patch({ confirmingDelete: true })
  }

  cancelDelete(): void {
    this.store.patch({ confirmingDelete: false })
  }

  /** Resolves to whether it is gone. */
  async delete(): Promise<boolean> {
    const workspace = this.workspace
    if (!workspace) return false
    this.store.patch({ deleting: true })
    try {
      await this.api.remove(workspace.id)
      this.workspaces.forget(workspace.id)
      toast.success(`${workspace.name} is deleted`)
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      this.store.patch({ deleting: false, confirmingDelete: false })
    }
  }
}
