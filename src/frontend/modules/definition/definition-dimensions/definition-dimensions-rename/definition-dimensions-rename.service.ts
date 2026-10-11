import { DimensionNameInputSchema, type DimensionDTO, type DimensionValueDTO } from '@newt/api/dimension'
import type { ProposalDTO } from '@newt/api/proposal'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { Store } from '../../../../core/store/store'
import { DefinitionDimensionsService } from '../definition-dimensions.service'

/** What is being renamed: a dimension, or one of its values. */
type Target = { dimension: DimensionDTO, value?: DimensionValueDTO }

/** Proposes a new name for a dimension or a value. Either keeps its id, so whatever uses it follows. */
export class DefinitionDimensionsRenameService {

  private readonly dimensions = inject(DefinitionDimensionsService)
  private readonly store = new Store<{ target: Target | null }>({ target: null })

  readonly target = this.store.select('target')

  readonly form = new FormStore(DimensionNameInputSchema, { name: '' }, {
    errorFields: { 'workspace.archived': 'name', validation: 'name' },
  })

  open(target: Target): void {
    this.form.reset({ name: target.value?.name ?? target.dimension.name })
    this.store.patch({ target })
  }

  close(): void {
    this.store.patch({ target: null })
  }

  async save(): Promise<ProposalDTO | undefined> {
    const target = this.store.value.target
    if (!target) return undefined
    const { dimension, value } = target

    let proposal: ProposalDTO | undefined
    await this.form.submit(async ({ name }) => {
      proposal = await this.dimensions.proposeChange(dimension, state => (value
        ? { ...state, values: state.values.map(each => (each.id === value.id ? { ...each, name } : each)) }
        : { ...state, name }))
    })
    if (proposal) this.close()
    return proposal
  }
}
