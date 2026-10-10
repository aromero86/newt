import { FeatureAreaApi, FeatureAreaCreateSchema, type FeatureAreaDTO } from '@newt/api/feature-area'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

/** A workspace's areas, page by page: the active ones in their order, and the retired ones on demand. */
export class DefinitionAreasService {

  private readonly api = inject(FeatureAreaApi)
  private readonly store = new Store({ workspaceId: '', showRetired: false })

  readonly active = new ListStore<FeatureAreaDTO>(page => this.api.list(this.store.value.workspaceId, page))
  readonly retired = new ListStore<FeatureAreaDTO>(page => this.api.list(this.store.value.workspaceId, page, true))
  readonly showRetired = this.store.select('showRetired')

  readonly form = new FormStore(FeatureAreaCreateSchema, { name: '', description: '' }, {
    errorFields: { 'featureArea.name_taken': 'name', 'workspace.archived': 'name', validation: 'name' },
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

  /** Resolves to the new area, if it was created. */
  async create(): Promise<FeatureAreaDTO | undefined> {
    let created: FeatureAreaDTO | undefined
    await this.form.submit(async input => {
      created = await this.api.create(this.store.value.workspaceId, input)
    })
    if (created) toast.success(`Area ${created.name} created`)
    return created
  }

  /** One place up (-1) or down (+1). */
  async move(area: FeatureAreaDTO, step: -1 | 1): Promise<void> {
    await this.attempt(() => this.api.move(this.store.value.workspaceId, area.id, area.position! + step))
  }

  async retire(area: FeatureAreaDTO): Promise<void> {
    await this.attempt(() => this.api.retire(this.store.value.workspaceId, area.id), `${area.name} retired`)
  }

  async restore(area: FeatureAreaDTO): Promise<void> {
    await this.attempt(() => this.api.restore(this.store.value.workspaceId, area.id), `${area.name} restored`)
  }

  /** Any change moves others around: the lists start over. */
  private async attempt(action: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await action()
      await Promise.all([this.active.loadFirstPage(), this.store.value.showRetired ? this.retired.loadFirstPage() : Promise.resolve()])
      if (done) toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
