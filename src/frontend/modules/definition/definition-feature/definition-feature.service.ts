import { ApiError } from '@newt/api/core/api-error'
import { FeatureApi, type FeatureDTO } from '@newt/api/feature'
import { FeatureAreaApi, FeatureAreaCreateSchema, type FeatureAreaDTO } from '@newt/api/feature-area'
import type { ProposalDTO } from '@newt/api/proposal'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'

type FeatureState = {
  workspaceId: string
  /** Undefined while loading; null if there is no such feature. */
  feature: FeatureDTO | null | undefined
  area: FeatureAreaDTO | null
  editing: boolean
  moving: boolean
  /** The area picked to move the feature to. */
  target: string | undefined
}

/** One feature: reading it, and proposing to change it, move it to another area or retire it. */
export class DefinitionFeatureService {

  private readonly api = inject(FeatureApi)
  private readonly areaApi = inject(FeatureAreaApi)
  private readonly quick = inject(QuickProposalService)
  private readonly store = new Store<FeatureState>({ workspaceId: '', feature: undefined, area: null, editing: false, moving: false, target: undefined })

  readonly feature = this.store.select('feature')
  readonly area = this.store.select('area')
  readonly editing = this.store.select('editing')
  readonly moving = this.store.select('moving')
  readonly target = this.store.select('target')

  /** Where it can move to: the active areas, a page at a time. */
  readonly areas = new ListStore<FeatureAreaDTO>(page => this.areaApi.list(this.store.value.workspaceId, page), 100)

  // A feature's name and description follow the same rules as an area's.
  readonly editForm = new FormStore(FeatureAreaCreateSchema, { name: '', description: '' }, { errorFields: { 'workspace.archived': 'name' } })

  async load(workspaceId: string, featureId: string): Promise<void> {
    this.store.patch({ workspaceId, feature: undefined, area: null, editing: false, moving: false })
    try {
      const feature = await this.api.one(workspaceId, featureId)
      this.store.patch({ feature, area: await this.areaApi.one(workspaceId, feature.areaId) })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ feature: null })
      else throw error
    }
  }

  openEdit(): void {
    const feature = this.store.value.feature
    if (!feature) return
    this.editForm.reset({ name: feature.name, description: feature.description })
    this.store.patch({ editing: true })
  }

  closeEdit(): void {
    this.store.patch({ editing: false })
  }

  /** Proposes its new name and description; it stays in its area. */
  async saveEdit(): Promise<ProposalDTO | undefined> {
    const feature = this.store.value.feature
    if (!feature) return undefined
    let proposal: ProposalDTO | undefined
    await this.editForm.submit(async ({ name, description }) => {
      proposal = await this.proposeChange(feature, { areaId: feature.areaId, name, description })
    })
    if (proposal) this.closeEdit()
    return proposal
  }

  async openMove(): Promise<void> {
    this.store.patch({ moving: true, target: undefined })
    await this.areas.loadFirstPage()
  }

  closeMove(): void {
    this.store.patch({ moving: false })
  }

  pick(areaId: string): void {
    this.store.patch({ target: areaId })
  }

  /** Proposes moving it to the end of the picked area. */
  async move(): Promise<ProposalDTO | undefined> {
    const { feature, target } = this.store.value
    if (!feature || !target) return undefined
    const proposal = await this.proposeChange(feature, { areaId: target, name: feature.name, description: feature.description })
    if (proposal) this.closeMove()
    return proposal
  }

  proposeRetiring(): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature', operation: 'retire', targetId: this.store.value.feature!.id })
  }

  proposeRestoring(): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature', operation: 'restore', targetId: this.store.value.feature!.id })
  }

  private proposeChange(feature: FeatureDTO, after: { areaId: string, name: string, description: string }): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature', operation: 'change', targetId: feature.id, after })
  }
}
