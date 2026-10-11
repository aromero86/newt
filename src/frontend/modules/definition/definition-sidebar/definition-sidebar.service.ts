import { FeatureAreaApi, type FeatureAreaDTO } from '@newt/api/feature-area'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

/** The areas the definition's menu lists, a hundred at a time. */
export class DefinitionSidebarService {

  private readonly api = inject(FeatureAreaApi)
  private readonly store = new Store({ workspaceId: '' })

  readonly areas = new ListStore<FeatureAreaDTO>(page => this.api.list(this.store.value.workspaceId, page), 100)

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId })
    await this.areas.loadFirstPage()
  }
}
