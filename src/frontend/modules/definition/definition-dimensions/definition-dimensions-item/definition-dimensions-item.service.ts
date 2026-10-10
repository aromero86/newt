import { DimensionApi, DimensionNameInputSchema, type DimensionDTO } from '@newt/api/dimension'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { DefinitionDimensionsService } from '../definition-dimensions.service'

/** Adding values to one dimension. */
export class DefinitionDimensionsItemService {

  private readonly api = inject(DimensionApi)
  private readonly dimensions = inject(DefinitionDimensionsService)

  readonly form = new FormStore(DimensionNameInputSchema, { name: '' }, {
    errorFields: { 'dimension.value_name_taken': 'name', 'dimension.limit_reached': 'name', 'workspace.archived': 'name', validation: 'name' },
  })

  async addValue(dimension: DimensionDTO): Promise<void> {
    const added = await this.form.submit(async input => {
      this.dimensions.replace(await this.api.addValue(this.dimensions.workspaceId, dimension.id, input))
    })
    if (added) this.form.reset({ name: '' })
  }
}
