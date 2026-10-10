import type { FeatureCreateDTO, FeatureDTO, FeatureMoveDTO, FeatureUpdateDTO } from '../../../backend/modules/feature/feature.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `feature` module: what can be done in the product, area by area. */
export class FeatureApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of an area's active features, in their order; with `retired`, of the retired ones. */
  list(workspaceId: string, areaId: string, page?: PageRequest, retired = false) {
    return this.get<Page<FeatureDTO>>(`/${workspaceId}/feature-areas/${areaId}/features`, { ...page, ...(retired ? { retired: 'true' } : {}) })
  }

  one(workspaceId: string, featureId: string) {
    return this.get<FeatureDTO>(`/${workspaceId}/features/${featureId}`)
  }

  create(workspaceId: string, input: FeatureCreateDTO) {
    return this.post<FeatureDTO>(`/${workspaceId}/features`, input)
  }

  update(workspaceId: string, featureId: string, input: FeatureUpdateDTO) {
    return this.patch<FeatureDTO>(`/${workspaceId}/features/${featureId}`, input)
  }

  /** To another area (at its end unless a position is given), to another place, or both. */
  move(workspaceId: string, featureId: string, input: FeatureMoveDTO) {
    return this.post<FeatureDTO>(`/${workspaceId}/features/${featureId}/move`, input)
  }

  retire(workspaceId: string, featureId: string) {
    return this.post<FeatureDTO>(`/${workspaceId}/features/${featureId}/retire`)
  }

  restore(workspaceId: string, featureId: string) {
    return this.post<FeatureDTO>(`/${workspaceId}/features/${featureId}/restore`)
  }
}
