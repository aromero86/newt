import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { RuleApi, type RuleDTO } from '@newt/api/rule'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

type RulesState = {
  workspaceId: string
  featureId: string | undefined
  dimensions: DimensionDTO[]
  /** The value picked for each dimension; a dimension that is not here is not filtered. */
  appliesIn: Record<string, string>
  retired: boolean
}

/** Rules page by page: of a whole workspace or of one feature, filtered by where they apply. */
export class DefinitionRulesService {

  private readonly api = inject(RuleApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly store = new Store<RulesState>({ workspaceId: '', featureId: undefined, dimensions: [], appliesIn: {}, retired: false })

  readonly dimensions = this.store.select('dimensions')
  readonly appliesIn = this.store.select('appliesIn')
  readonly retired = this.store.select('retired')

  readonly rules = new ListStore<RuleDTO>(page => {
    const { workspaceId, featureId, appliesIn, retired } = this.store.value
    const filter = Object.entries(appliesIn).map(([dimensionId, valueId]) => ({ dimensionId, valueId }))
    return this.api.list(workspaceId, { featureId, retired, appliesIn: filter }, page)
  })

  async load(workspaceId: string, featureId?: string): Promise<void> {
    this.store.patch({ workspaceId, featureId, appliesIn: {}, retired: false })
    const [dimensions] = await Promise.all([this.dimensionApi.list(workspaceId), this.rules.loadFirstPage()])
    this.store.patch({ dimensions })
  }

  /** Only the rules that apply in this value of the dimension; `undefined` drops the filter. */
  async filter(dimensionId: string, valueId: string | undefined): Promise<void> {
    this.store.update(({ appliesIn }) => {
      const { [dimensionId]: _, ...rest } = appliesIn
      return { appliesIn: valueId ? { ...rest, [dimensionId]: valueId } : rest }
    })
    await this.rules.loadFirstPage()
  }

  /** The rules in force, or the retired ones. */
  async showRetired(retired: boolean): Promise<void> {
    this.store.patch({ retired })
    await this.rules.loadFirstPage()
  }
}
