import { DimensionNameInputSchema, type DimensionDTO } from '@newt/api/dimension'
import type { ProposalDTO } from '@newt/api/proposal'
import { FormStore } from '../../../../core/form/form-store'
import { Store } from '../../../../core/store/store'
import { inject } from '../../../../core/injector/inject'
import { DefinitionDimensionsService } from '../definition-dimensions.service'

/** Proposing new values for one dimension. */
export class DefinitionDimensionsItemService {

  private readonly dimensions = inject(DefinitionDimensionsService)
  private readonly store = new Store({ adding: false })

  readonly adding = this.store.select('adding')

  readonly form = new FormStore(DimensionNameInputSchema, { name: '' }, {
    errorFields: { 'workspace.archived': 'name', validation: 'name' },
  })

  async addValue(dimension: DimensionDTO): Promise<ProposalDTO | undefined> {
    let proposal: ProposalDTO | undefined
    await this.form.submit(async ({ name }) => {
      proposal = await this.dimensions.proposeChange(dimension, state => ({ ...state, values: [...state.values, { name, retired: false }] }))
    })
    if (proposal) this.closeAdd()
    return proposal
  }

  openAdd(): void {
    this.form.reset({ name: '' })
    this.store.patch({ adding: true })
  }

  closeAdd(): void {
    this.store.patch({ adding: false })
  }
}
