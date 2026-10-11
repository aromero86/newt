import { BaselineApi, type BaselinePlannedDTO } from '@newt/api/baseline'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

/** The merged proposals that changed one artifact, oldest first. */
export class DefinitionHistoryService {

  private readonly api = inject(BaselineApi)
  private readonly store = new Store({ workspaceId: '', targetId: '' })

  readonly history = new ListStore<BaselinePlannedDTO & { id: string }>(async page => {
    const { workspaceId, targetId } = this.store.value
    const history = await this.api.history(workspaceId, targetId, page)
    return { ...history, items: history.items.map(each => ({ ...each, id: each.delta.id })) }
  })

  async load(workspaceId: string, targetId: string): Promise<void> {
    this.store.patch({ workspaceId, targetId })
    await this.history.loadFirstPage()
  }
}
