import { SearchApi, type SearchResultDTO, type SearchSemantic } from '@newt/api/search'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

/** What talks about the same as one artifact in force, closest first. */
export class DefinitionSimilarService {

  private readonly api = inject(SearchApi)
  private readonly store = new Store<{ workspaceId: string, targetId: string, semantic: SearchSemantic }>({ workspaceId: '', targetId: '', semantic: 'ready' })

  readonly semantic = this.store.select('semantic')

  readonly similar = new ListStore<SearchResultDTO>(async page => {
    const { workspaceId, targetId } = this.store.value
    const similar = await this.api.similar(workspaceId, targetId, { ...page, size: 5 })
    this.store.patch({ semantic: similar.semantic })
    return similar
  })

  async load(workspaceId: string, targetId: string): Promise<void> {
    this.store.patch({ workspaceId, targetId })
    await this.similar.loadFirstPage()
  }
}
