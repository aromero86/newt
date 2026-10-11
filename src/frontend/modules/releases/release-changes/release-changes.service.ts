import { ReleaseApi, type ReleaseChangeDTO } from '@newt/api/release'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

type ChangesState = {
  workspaceId: string
  /** The release whose changes these are; null for what is not released yet. */
  release: string | null
  dimensions: DimensionDTO[]
}

/** What changed, page by page: since the last release, or in one release. */
export class ReleaseChangesService {

  private readonly api = inject(ReleaseApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly store = new Store<ChangesState>({ workspaceId: '', release: null, dimensions: [] })

  readonly dimensions = this.store.select('dimensions')
  readonly changes = new ListStore<ReleaseChangeDTO>(page => {
    const { workspaceId, release } = this.store.value
    return release ? this.api.changes(workspaceId, release, page) : this.api.unpublished(workspaceId, page)
  })

  async load(workspaceId: string, release: string | null): Promise<void> {
    this.store.patch({ workspaceId, release })
    const [dimensions] = await Promise.all([this.dimensionApi.list(workspaceId), this.changes.loadFirstPage()])
    this.store.patch({ dimensions })
  }
}
