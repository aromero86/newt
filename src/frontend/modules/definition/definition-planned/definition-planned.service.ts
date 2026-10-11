import { BaselineApi, type BaselinePlannedDTO } from '@newt/api/baseline'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'

type PlannedItem = BaselinePlannedDTO & { id: string }

/** The planned definition: what accepted proposals change once their code is in, page by page. */
export class DefinitionPlannedService {

  private readonly api = inject(BaselineApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly artifactNames = inject(ArtifactNamesService)
  private readonly store = new Store<{ workspaceId: string, dimensions: DimensionDTO[] }>({ workspaceId: '', dimensions: [] })

  readonly dimensions = this.store.select('dimensions')
  readonly names = this.artifactNames.names

  readonly planned = new ListStore<PlannedItem>(async page => {
    const { workspaceId } = this.store.value
    const planned = await this.api.planned(workspaceId, undefined, page)
    await this.artifactNames.resolve(workspaceId, planned.items.map(each => each.delta))
    return { ...planned, items: planned.items.map(each => ({ ...each, id: each.delta.id })) }
  })

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId })
    const [dimensions] = await Promise.all([this.dimensionApi.list(workspaceId), this.planned.loadFirstPage()])
    this.store.patch({ dimensions })
  }

  name(id: string): string {
    return this.artifactNames.name(id)
  }
}
