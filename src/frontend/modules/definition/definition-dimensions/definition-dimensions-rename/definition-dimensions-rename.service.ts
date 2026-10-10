import { DimensionApi, DimensionNameInputSchema, type DimensionDTO, type DimensionValueDTO } from '@newt/api/dimension'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { Store } from '../../../../core/store/store'
import { DefinitionDimensionsService } from '../definition-dimensions.service'

/** What is being renamed: a dimension, or one of its values. */
type Target = { dimension: DimensionDTO, value?: DimensionValueDTO }

/** Renames a dimension or a value. Either keeps its id, so whatever uses it follows. */
export class DefinitionDimensionsRenameService {

  private readonly api = inject(DimensionApi)
  private readonly dimensions = inject(DefinitionDimensionsService)
  private readonly store = new Store<{ target: Target | null }>({ target: null })

  readonly target = this.store.select('target')

  readonly form = new FormStore(DimensionNameInputSchema, { name: '' }, {
    errorFields: { 'dimension.name_taken': 'name', 'dimension.value_name_taken': 'name', 'workspace.archived': 'name', validation: 'name' },
  })

  open(target: Target): void {
    this.form.reset({ name: target.value?.name ?? target.dimension.name })
    this.store.patch({ target })
  }

  close(): void {
    this.store.patch({ target: null })
  }

  async save(): Promise<void> {
    const target = this.store.value.target
    if (!target) return
    const { dimension, value } = target
    const workspaceId = this.dimensions.workspaceId

    const done = await this.form.submit(async input => {
      this.dimensions.replace(value
        ? await this.api.renameValue(workspaceId, dimension.id, value.id, input)
        : await this.api.rename(workspaceId, dimension.id, input))
    })
    if (done) {
      this.close()
      toast.success('Renamed')
    }
  }
}
