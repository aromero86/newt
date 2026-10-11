import { FeatureApi } from '@newt/api/feature'
import { FeatureAreaApi } from '@newt/api/feature-area'
import type { DeltaDTO } from '@newt/api/proposal'
import { inject } from '../../core/injector/inject'
import { Store } from '../../core/store/store'

/** Names of the areas and features that deltas point at by id. */
export class ArtifactNamesService {

  private readonly areaApi = inject(FeatureAreaApi)
  private readonly featureApi = inject(FeatureApi)
  private readonly store = new Store<{ names: Record<string, string> }>({ names: {} })

  readonly names = this.store.select('names')

  name(id: string): string {
    return this.store.value.names[id] ?? 'Unknown'
  }

  /** Learns the names these deltas need: from the deltas that create them, or from the definition. */
  async resolve(workspaceId: string, deltas: DeltaDTO[]): Promise<void> {
    const names: Record<string, string> = { ...this.store.value.names }
    for (const delta of deltas) {
      if (delta.operation === 'create' && (delta.kind === 'feature-area' || delta.kind === 'feature')) names[delta.targetId] = delta.targetLabel
    }
    const wanted = new Map<string, 'area' | 'feature'>()
    for (const delta of deltas) {
      for (const state of [delta.before, delta.after] as ({ areaId?: string, featureId?: string } | null)[]) {
        if (state?.areaId && !names[state.areaId]) wanted.set(state.areaId, 'area')
        if (state?.featureId && !names[state.featureId]) wanted.set(state.featureId, 'feature')
      }
    }
    await Promise.all([...wanted].map(async ([id, kind]) => {
      try {
        names[id] = (kind === 'area' ? await this.areaApi.one(workspaceId, id) : await this.featureApi.one(workspaceId, id)).name
      } catch {
        names[id] = 'Unknown'
      }
    }))
    this.store.patch({ names })
  }
}
