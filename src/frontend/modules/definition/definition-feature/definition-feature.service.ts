import { ApiError } from '@newt/api/core/api-error'
import { FeatureApi, FeatureUpdateSchema, type FeatureDTO } from '@newt/api/feature'
import { FeatureAreaApi, type FeatureAreaDTO } from '@newt/api/feature-area'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

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

/** One feature: reading it, editing it, moving it to another area, retiring it. */
export class DefinitionFeatureService {

  private readonly api = inject(FeatureApi)
  private readonly areaApi = inject(FeatureAreaApi)
  private readonly store = new Store<FeatureState>({ workspaceId: '', feature: undefined, area: null, editing: false, moving: false, target: undefined })

  readonly feature = this.store.select('feature')
  readonly area = this.store.select('area')
  readonly editing = this.store.select('editing')
  readonly moving = this.store.select('moving')
  readonly target = this.store.select('target')

  /** Where it can move to: the active areas, a page at a time. */
  readonly areas = new ListStore<FeatureAreaDTO>(page => this.areaApi.list(this.store.value.workspaceId, page), 100)

  readonly editForm = new FormStore(FeatureUpdateSchema, { name: '', description: '' }, {
    errorFields: { 'feature.name_taken': 'name', 'feature.retired': 'name', 'workspace.archived': 'name' },
  })

  async load(workspaceId: string, featureId: string): Promise<void> {
    this.store.patch({ workspaceId, feature: undefined, area: null, editing: false, moving: false })
    try {
      await this.show(await this.api.one(workspaceId, featureId))
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

  async saveEdit(): Promise<void> {
    const { workspaceId, feature } = this.store.value
    if (!feature) return
    const saved = await this.editForm.submit(async changes => {
      this.store.patch({ feature: await this.api.update(workspaceId, feature.id, changes) })
    })
    if (saved) {
      this.closeEdit()
      toast.success('Feature saved')
    }
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

  /** To the end of the picked area. */
  async move(): Promise<void> {
    const { workspaceId, feature, target } = this.store.value
    if (!feature || !target) return
    try {
      await this.show(await this.api.move(workspaceId, feature.id, { areaId: target }))
      this.closeMove()
      toast.success(`Moved to ${this.store.value.area?.name ?? 'the area'}`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async retire(): Promise<void> {
    await this.change(feature => this.api.retire(this.store.value.workspaceId, feature.id), 'Feature retired')
  }

  async restore(): Promise<void> {
    await this.change(feature => this.api.restore(this.store.value.workspaceId, feature.id), 'Feature restored')
  }

  private async change(action: (feature: FeatureDTO) => Promise<FeatureDTO>, done: string): Promise<void> {
    const feature = this.store.value.feature
    if (!feature) return
    try {
      await this.show(await action(feature))
      toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  private async show(feature: FeatureDTO): Promise<void> {
    const area = await this.areaApi.one(this.store.value.workspaceId, feature.areaId)
    this.store.patch({ feature, area })
  }
}
