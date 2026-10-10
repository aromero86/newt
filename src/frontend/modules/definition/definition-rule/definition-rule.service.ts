import { ApiError } from '@newt/api/core/api-error'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { RuleApi, type RuleDTO, type RuleVersionDTO } from '@newt/api/rule'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

type RuleState = {
  workspaceId: string
  key: string
  /** Undefined while loading; null if there is no such rule. */
  rule: RuleDTO | null | undefined
  dimensions: DimensionDTO[]
}

/** One rule and its history, newest version first. */
export class DefinitionRuleService {

  private readonly api = inject(RuleApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly store = new Store<RuleState>({ workspaceId: '', key: '', rule: undefined, dimensions: [] })

  readonly rule = this.store.select('rule')
  readonly dimensions = this.store.select('dimensions')

  /** Two at first: the version in force and the one it replaced. */
  readonly versions = new ListStore<RuleVersionDTO>(page => this.api.versions(this.store.value.workspaceId, this.store.value.key, page), 2)

  async load(workspaceId: string, key: string): Promise<void> {
    this.store.patch({ workspaceId, key, rule: undefined })
    try {
      const [rule, dimensions] = await Promise.all([this.api.one(workspaceId, key), this.dimensionApi.list(workspaceId)])
      this.store.patch({ rule, dimensions })
      await this.versions.loadFirstPage()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ rule: null })
      else throw error
    }
  }
}
