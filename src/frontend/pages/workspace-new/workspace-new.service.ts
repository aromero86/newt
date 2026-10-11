import { WorkspaceCreateSchema, type WorkspaceMineDTO } from '@newt/api/workspace'
import { FormStore } from '../../core/form/form-store'
import { inject } from '../../core/injector/inject'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

export class WorkspaceNewService {

  private readonly workspaces = inject(WorkspacesService)

  readonly form = new FormStore(WorkspaceCreateSchema, { name: '', description: '', language: 'en' }, {
    errorFields: { 'workspace.name_taken': 'name' },
  })

  /** Resolves to the new workspace, or `null` when it could not be created. */
  async submit(): Promise<WorkspaceMineDTO | null> {
    let created: WorkspaceMineDTO | null = null
    await this.form.submit(async input => {
      created = await this.workspaces.create(input)
    })
    return created
  }
}
