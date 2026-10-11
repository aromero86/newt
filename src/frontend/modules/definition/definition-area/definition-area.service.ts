import { ApiError } from '@newt/api/core/api-error'
import { FeatureApi, FeatureCreateSchema, type FeatureDTO } from '@newt/api/feature'
import { FeatureAreaApi, FeatureAreaCreateSchema, type FeatureAreaDTO } from '@newt/api/feature-area'
import type { ProposalDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'

type AreaState = {
  workspaceId: string
  areaId: string
  /** Undefined while loading; null if there is no such area. */
  area: FeatureAreaDTO | null | undefined
  editing: boolean
  creating: boolean
  showRetired: boolean
  retiredTotal: number
}

const CreateSchema = FeatureCreateSchema.omit({ areaId: true })

/**
 * One area: its details, and its features page by page. The order of its features
 * changes here; anything else is proposed.
 */
export class DefinitionAreaService {

  private readonly areaApi = inject(FeatureAreaApi)
  private readonly featureApi = inject(FeatureApi)
  private readonly quick = inject(QuickProposalService)
  private readonly store = new Store<AreaState>({ workspaceId: '', areaId: '', area: undefined, editing: false, creating: false, showRetired: false, retiredTotal: 0 })

  readonly area = this.store.select('area')
  readonly editing = this.store.select('editing')
  readonly showRetired = this.store.select('showRetired')
  readonly creating = this.store.select('creating')
  readonly retiredTotal = this.store.select('retiredTotal')

  readonly features = new ListStore<FeatureDTO>(page => this.featureApi.list(this.store.value.workspaceId, this.store.value.areaId, page))
  readonly retired = new ListStore<FeatureDTO>(page => this.featureApi.list(this.store.value.workspaceId, this.store.value.areaId, page, true))

  readonly form = new FormStore(CreateSchema, { name: '', description: '' }, { errorFields: { 'workspace.archived': 'name', validation: 'name' } })
  readonly editForm = new FormStore(FeatureAreaCreateSchema, { name: '', description: '' }, { errorFields: { 'workspace.archived': 'name' } })

  async load(workspaceId: string, areaId: string): Promise<void> {
    this.store.patch({ workspaceId, areaId, area: undefined, editing: false, showRetired: false })
    this.form.reset({ name: '', description: '' })
    try {
      this.store.patch({ area: await this.areaApi.one(workspaceId, areaId) })
      const [, retired] = await Promise.all([this.features.loadFirstPage(), this.featureApi.list(workspaceId, areaId, { size: 1 }, true)])
      this.store.patch({ retiredTotal: retired.total })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ area: null })
      else throw error
    }
  }

  /** Proposes a new feature in this area. */
  async create(): Promise<ProposalDTO | undefined> {
    const { workspaceId, areaId } = this.store.value
    let proposal: ProposalDTO | undefined
    await this.form.submit(async input => {
      proposal = await this.quick.propose(workspaceId, { kind: 'feature', operation: 'create', after: { ...input, areaId } })
    })
    if (proposal) this.closeCreate()
    return proposal
  }

  openCreate(): void {
    this.form.reset({ name: '', description: '' })
    this.store.patch({ creating: true })
  }

  closeCreate(): void {
    this.store.patch({ creating: false })
  }

  /** One place up (-1) or down (+1) in the area. */
  async move(feature: FeatureDTO, step: -1 | 1): Promise<void> {
    try {
      await this.featureApi.move(this.store.value.workspaceId, feature.id, feature.position! + step)
      await this.features.loadFirstPage()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  proposeRetiring(feature: FeatureDTO): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature', operation: 'retire', targetId: feature.id })
  }

  proposeRestoring(feature: FeatureDTO): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature', operation: 'restore', targetId: feature.id })
  }

  /** The area's active features, or its retired ones. */
  async show(retired: boolean): Promise<void> {
    this.store.patch({ showRetired: retired })
    if (retired) await this.retired.loadFirstPage()
  }

  openEdit(): void {
    const area = this.store.value.area
    if (!area) return
    this.editForm.reset({ name: area.name, description: area.description })
    this.store.patch({ editing: true })
  }

  closeEdit(): void {
    this.store.patch({ editing: false })
  }

  /** Proposes the area's new name and description. */
  async saveEdit(): Promise<ProposalDTO | undefined> {
    const { workspaceId, areaId } = this.store.value
    let proposal: ProposalDTO | undefined
    await this.editForm.submit(async after => {
      proposal = await this.quick.propose(workspaceId, { kind: 'feature-area', operation: 'change', targetId: areaId, after })
    })
    if (proposal) this.closeEdit()
    return proposal
  }

  proposeRetiringArea(): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature-area', operation: 'retire', targetId: this.store.value.areaId })
  }

  proposeRestoringArea(): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature-area', operation: 'restore', targetId: this.store.value.areaId })
  }
}
