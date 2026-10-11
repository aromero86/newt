import { FeatureAreaApi, FeatureAreaCreateSchema, type FeatureAreaDTO } from '@newt/api/feature-area'
import type { ProposalDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'

/**
 * A workspace's areas, page by page: the active ones in their order, and the retired
 * ones on demand. Their order changes here; anything else is proposed.
 */
export class DefinitionAreasService {

  private readonly api = inject(FeatureAreaApi)
  private readonly quick = inject(QuickProposalService)
  private readonly store = new Store({ workspaceId: '', showRetired: false })

  readonly active = new ListStore<FeatureAreaDTO>(page => this.api.list(this.store.value.workspaceId, page))
  readonly retired = new ListStore<FeatureAreaDTO>(page => this.api.list(this.store.value.workspaceId, page, true))
  readonly showRetired = this.store.select('showRetired')

  readonly form = new FormStore(FeatureAreaCreateSchema, { name: '', description: '' }, {
    errorFields: { 'workspace.archived': 'name', validation: 'name' },
  })

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId, showRetired: false })
    this.form.reset({ name: '', description: '' })
    await this.active.loadFirstPage()
  }

  async toggleRetired(): Promise<void> {
    const showRetired = !this.store.value.showRetired
    this.store.patch({ showRetired })
    if (showRetired) await this.retired.loadFirstPage()
  }

  /** Proposes a new area. */
  async create(): Promise<ProposalDTO | undefined> {
    let proposal: ProposalDTO | undefined
    await this.form.submit(async after => {
      proposal = await this.quick.propose(this.store.value.workspaceId, { kind: 'feature-area', operation: 'create', after })
    })
    if (proposal) this.form.reset({ name: '', description: '' })
    return proposal
  }

  /** One place up (-1) or down (+1). */
  async move(area: FeatureAreaDTO, step: -1 | 1): Promise<void> {
    await this.attempt(() => this.api.move(this.store.value.workspaceId, area.id, area.position! + step))
  }

  proposeRetiring(area: FeatureAreaDTO): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature-area', operation: 'retire', targetId: area.id })
  }

  proposeRestoring(area: FeatureAreaDTO): Promise<ProposalDTO | undefined> {
    return this.quick.propose(this.store.value.workspaceId, { kind: 'feature-area', operation: 'restore', targetId: area.id })
  }

  /** Moving one moves others around: the lists start over. */
  private async attempt(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      await Promise.all([this.active.loadFirstPage(), this.store.value.showRetired ? this.retired.loadFirstPage() : Promise.resolve()])
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
