import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { FeatureApi, type FeatureDTO } from '@newt/api/feature'
import { SearchApi, type SearchKind, type SearchResultDTO, type SearchSemantic } from '@newt/api/search'
import { inject } from '../../core/injector/inject'
import { ListStore } from '../../core/list/list-store'
import { Store } from '../../core/store/store'

type SearchState = {
  workspaceId: string
  query: string
  /** Only what belongs to this feature, from the address. */
  feature: FeatureDTO | null
  /** All kinds when absent. */
  kind: SearchKind | undefined
  definition: 'in force' | 'planned'
  history: boolean
  dimensions: DimensionDTO[]
  /** The value picked for each dimension; a dimension that is not here is not filtered. */
  appliesIn: Record<string, string>
  semantic: SearchSemantic
}

/** A search in a workspace, page by page, and how it is narrowed. The query comes from the address. */
export class SearchService {

  private readonly api = inject(SearchApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly featureApi = inject(FeatureApi)
  private readonly store = new Store<SearchState>({ workspaceId: '', query: '', feature: null, kind: undefined, definition: 'in force', history: false, dimensions: [], appliesIn: {}, semantic: 'ready' })

  readonly feature = this.store.select('feature')
  readonly kind = this.store.select('kind')
  readonly definition = this.store.select('definition')
  readonly history = this.store.select('history')
  readonly dimensions = this.store.select('dimensions')
  readonly appliesIn = this.store.select('appliesIn')
  readonly semantic = this.store.select('semantic')

  readonly results = new ListStore<SearchResultDTO>(async page => {
    const { workspaceId, query, feature, kind, definition, history, appliesIn } = this.store.value
    const results = await this.api.search(workspaceId, {
      query,
      featureId: feature?.id,
      kinds: kind ? [kind] : undefined,
      definition,
      history,
      appliesIn: Object.entries(appliesIn).map(([dimensionId, valueId]) => ({ dimensionId, valueId })),
    }, page)
    this.store.patch({ semantic: results.semantic })
    return results
  })

  async load(workspaceId: string, query: string, featureId: string | undefined): Promise<void> {
    const sameWorkspace = this.store.value.workspaceId === workspaceId
    const feature = featureId ? await this.featureApi.one(workspaceId, featureId) : null
    this.store.patch({ workspaceId, query, feature })
    const [dimensions] = await Promise.all([sameWorkspace ? this.store.value.dimensions : this.dimensionApi.list(workspaceId), query ? this.results.loadFirstPage() : Promise.resolve()])
    this.store.patch({ dimensions })
  }

  async narrow(change: Partial<Pick<SearchState, 'kind' | 'definition' | 'history'>>): Promise<void> {
    this.store.patch(change)
    await this.results.loadFirstPage()
  }

  /** Only what applies in this value of the dimension; `undefined` drops the filter. */
  async filter(dimensionId: string, valueId: string | undefined): Promise<void> {
    this.store.update(({ appliesIn }) => {
      const { [dimensionId]: _, ...rest } = appliesIn
      return { appliesIn: valueId ? { ...rest, [dimensionId]: valueId } : rest }
    })
    await this.results.loadFirstPage()
  }
}
