import { WorkspaceCreateSchema, type WorkspaceDTO } from '@cooper/api/workspace'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Creating a workspace, with the signed-in person as its admin. */
export class WorkspaceNewService {

  private readonly workspaces = inject(WorkspacesService)

  readonly form = new FormStore(WorkspaceCreateSchema, { name: '' }, {
    errorFields: { validation: 'name' },
  })

  /** Resolves to the new workspace, or `null` when it could not be created. */
  async submit(): Promise<WorkspaceDTO | null> {
    let created: WorkspaceDTO | null = null
    await this.form.submit(async input => {
      created = await this.workspaces.create(input)
    })
    return created
  }
}
