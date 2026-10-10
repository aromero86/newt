import { ApiError } from '@newt/api/core/api-error'
import { FeatureApi, FeatureCreateSchema, type FeatureDTO } from '@newt/api/feature'
import { FeatureAreaApi, FeatureAreaUpdateSchema, type FeatureAreaDTO } from '@newt/api/feature-area'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

type AreaState = {
  workspaceId: string
  areaId: string
  /** Undefined while loading; null if there is no such area. */
  area: FeatureAreaDTO | null | undefined
  editing: boolean
  showRetired: boolean
}

const CreateSchema = FeatureCreateSchema.omit({ areaId: true })

/** One area: its details, and its features page by page. */
export class DefinitionAreaService {

  private readonly areaApi = inject(FeatureAreaApi)
  private readonly featureApi = inject(FeatureApi)
  private readonly store = new Store<AreaState>({ workspaceId: '', areaId: '', area: undefined, editing: false, showRetired: false })

  readonly area = this.store.select('area')
  readonly editing = this.store.select('editing')
  readonly showRetired = this.store.select('showRetired')

  readonly features = new ListStore<FeatureDTO>(page => this.featureApi.list(this.store.value.workspaceId, this.store.value.areaId, page))
  readonly retired = new ListStore<FeatureDTO>(page => this.featureApi.list(this.store.value.workspaceId, this.store.value.areaId, page, true))

  readonly form = new FormStore(CreateSchema, { name: '', description: '' }, {
    errorFields: { 'feature.name_taken': 'name', 'featureArea.retired': 'name', 'workspace.archived': 'name', validation: 'name' },
  })

  readonly editForm = new FormStore(FeatureAreaUpdateSchema, { name: '', description: '' }, {
    errorFields: { 'featureArea.name_taken': 'name', 'featureArea.retired': 'name', 'workspace.archived': 'name' },
  })

  async load(workspaceId: string, areaId: string): Promise<void> {
    this.store.patch({ workspaceId, areaId, area: undefined, editing: false, showRetired: false })
    this.form.reset({ name: '', description: '' })
    try {
      this.store.patch({ area: await this.areaApi.one(workspaceId, areaId) })
      await this.features.loadFirstPage()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ area: null })
      else throw error
    }
  }

  async create(): Promise<void> {
    const { workspaceId, areaId } = this.store.value
    let created: FeatureDTO | undefined
    await this.form.submit(async input => {
      created = await this.featureApi.create(workspaceId, { ...input, areaId })
    })
    if (!created) return
    this.form.reset({ name: '', description: '' })
    toast.success(`Feature ${created.name} created`)
    await this.refresh()
  }

  /** One place up (-1) or down (+1) in the area. */
  async move(feature: FeatureDTO, step: -1 | 1): Promise<void> {
    await this.attempt(() => this.featureApi.move(this.store.value.workspaceId, feature.id, { position: feature.position! + step }))
  }

  async retire(feature: FeatureDTO): Promise<void> {
    await this.attempt(() => this.featureApi.retire(this.store.value.workspaceId, feature.id), `${feature.name} retired`)
  }

  async restore(feature: FeatureDTO): Promise<void> {
    await this.attempt(() => this.featureApi.restore(this.store.value.workspaceId, feature.id), `${feature.name} restored`)
  }

  async toggleRetired(): Promise<void> {
    const showRetired = !this.store.value.showRetired
    this.store.patch({ showRetired })
    if (showRetired) await this.retired.loadFirstPage()
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

  async saveEdit(): Promise<void> {
    const { workspaceId, areaId } = this.store.value
    const saved = await this.editForm.submit(async changes => {
      this.store.patch({ area: await this.areaApi.update(workspaceId, areaId, changes) })
    })
    if (saved) {
      this.closeEdit()
      toast.success('Area saved')
    }
  }

  async retireArea(): Promise<void> {
    const { workspaceId, areaId } = this.store.value
    await this.attempt(async () => this.store.patch({ area: await this.areaApi.retire(workspaceId, areaId) }), 'Area retired')
  }

  async restoreArea(): Promise<void> {
    const { workspaceId, areaId } = this.store.value
    await this.attempt(async () => this.store.patch({ area: await this.areaApi.restore(workspaceId, areaId) }), 'Area restored')
  }

  private async attempt(action: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await action()
      await this.refresh()
      if (done) toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  /** Features moved around and the area's count changed: everything starts over. */
  private async refresh(): Promise<void> {
    const { workspaceId, areaId, showRetired } = this.store.value
    const [area] = await Promise.all([
      this.areaApi.one(workspaceId, areaId),
      this.features.loadFirstPage(),
      showRetired ? this.retired.loadFirstPage() : Promise.resolve(),
    ])
    this.store.patch({ area })
  }
}
