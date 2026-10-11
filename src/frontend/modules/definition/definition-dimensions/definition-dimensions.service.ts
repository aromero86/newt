import { DimensionApi, DimensionNameInputSchema, type DimensionDTO, type DimensionValueDTO } from '@newt/api/dimension'
import type { DeltaDimensionState, ProposalDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { Store } from '../../../core/store/store'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'

type DimensionsState = {
  workspaceId: string
  dimensions: DimensionDTO[]
  loaded: boolean
}

/**
 * A workspace's dimensions and their values, all at once: there are few by design.
 * Their order changes here; anything else is proposed.
 */
export class DefinitionDimensionsService {

  private readonly api = inject(DimensionApi)
  private readonly quick = inject(QuickProposalService)
  private readonly store = new Store<DimensionsState>({ workspaceId: '', dimensions: [], loaded: false })

  readonly dimensions = this.store.select('dimensions')
  readonly loaded = this.store.select('loaded')

  readonly form = new FormStore(DimensionNameInputSchema, { name: '' }, {
    errorFields: { 'workspace.archived': 'name', validation: 'name' },
  })

  get workspaceId(): string {
    return this.store.value.workspaceId
  }

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId, dimensions: [], loaded: false })
    this.form.reset({ name: '' })
    const dimensions = await this.api.list(workspaceId)
    this.store.patch({ dimensions, loaded: true })
  }

  /** Proposes a new dimension, with no values yet. */
  async create(): Promise<ProposalDTO | undefined> {
    let proposal: ProposalDTO | undefined
    await this.form.submit(async ({ name }) => {
      proposal = await this.quick.propose(this.workspaceId, { kind: 'dimension', operation: 'create', after: { name, values: [] } })
    })
    if (proposal) this.form.reset({ name: '' })
    return proposal
  }

  /** Proposes a change to a dimension: its state as it is now, changed by `change`. */
  proposeChange(dimension: DimensionDTO, change: (state: DeltaDimensionState) => DeltaDimensionState): Promise<ProposalDTO | undefined> {
    const state = { name: dimension.name, values: dimension.values.map(value => ({ id: value.id, name: value.name, retired: value.retiredAt !== null })) }
    return this.quick.propose(this.workspaceId, { kind: 'dimension', operation: 'change', targetId: dimension.id, after: change(state) })
  }

  /** Puts a fresh copy of a dimension in its place, after any change to it. */
  replace(dimension: DimensionDTO): void {
    this.store.update(state => ({ dimensions: state.dimensions.map(each => each.id === dimension.id ? dimension : each) }))
  }

  /** Moves a dimension one place up (-1) or down (+1). */
  async move(dimension: DimensionDTO, step: -1 | 1): Promise<void> {
    const order = swap(this.store.value.dimensions.map(each => each.id), dimension.id, step)
    if (order) await this.attempt(async () => this.store.patch({ dimensions: await this.api.reorder(this.workspaceId, order) }))
  }

  async moveValue(dimension: DimensionDTO, value: DimensionValueDTO, step: -1 | 1): Promise<void> {
    // Among the active values; retired ones keep their place after them.
    const active = swap(dimension.values.filter(each => !each.retiredAt).map(each => each.id), value.id, step)
    const order = active && [...active, ...dimension.values.filter(each => each.retiredAt).map(each => each.id)]
    if (order) await this.attempt(async () => this.replace(await this.api.reorderValues(this.workspaceId, dimension.id, order)))
  }

  proposeRetiring(dimension: DimensionDTO, value: DimensionValueDTO): Promise<ProposalDTO | undefined> {
    return this.proposeChange(dimension, state => ({ ...state, values: state.values.map(each => (each.id === value.id ? { ...each, retired: true } : each)) }))
  }

  proposeRestoring(dimension: DimensionDTO, value: DimensionValueDTO): Promise<ProposalDTO | undefined> {
    return this.proposeChange(dimension, state => ({ ...state, values: state.values.map(each => (each.id === value.id ? { ...each, retired: false } : each)) }))
  }

  private async attempt(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}

/** `ids` with `id` swapped with its neighbour, or null if it is already at that end. */
function swap(ids: string[], id: string, step: -1 | 1): string[] | null {
  const from = ids.indexOf(id)
  const to = from + step
  if (from < 0 || to < 0 || to >= ids.length) return null
  const order = [...ids]
  ;[order[from], order[to]] = [order[to]!, order[from]!]
  return order
}
