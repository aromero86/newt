import { BackofficeWorkspaceApi, type WorkspaceSummaryDTO } from '@cooper/api/backoffice-workspace'
import { inject, ListStore, Store } from 'newt-kit-react'

type WorkspacesState = {
  /** The name looked for; empty for every workspace. */
  name: string
}

/** Every workspace of cooper, the newest first, or those with a name. */
export class WorkspacesService {

  private readonly api = inject(BackofficeWorkspaceApi)
  private readonly store = new Store<WorkspacesState>({ name: '' })

  readonly name = this.store.select('name')
  readonly list = new ListStore<WorkspaceSummaryDTO>(page => this.api.list(this.store.value.name || undefined, page))

  load(): Promise<void> {
    return this.list.loadFirstPage()
  }

  /** Those with this name, whole and whatever its case; an empty one shows them all again. */
  search(name: string): Promise<void> {
    this.store.patch({ name: name.trim() })
    return this.list.loadFirstPage()
  }
}
