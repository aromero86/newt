import { BaselineApi, type BaselinePlannedDTO } from '@newt/api/baseline'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

/** The accepted changes still without code on some artifacts. */
export class DefinitionPlannedNoticeService {

  private readonly api = inject(BaselineApi)
  private readonly store = new Store({ workspaceId: '', targetIds: [] as string[] })

  readonly planned = new ListStore<BaselinePlannedDTO & { id: string }>(async page => {
    const { workspaceId, targetIds } = this.store.value
    const planned = await this.api.planned(workspaceId, targetIds, page)
    return { ...planned, items: planned.items.map(each => ({ ...each, id: each.delta.id })) }
  })

  async load(workspaceId: string, targetIds: string[]): Promise<void> {
    this.store.patch({ workspaceId, targetIds })
    await this.planned.loadFirstPage()
  }
}
