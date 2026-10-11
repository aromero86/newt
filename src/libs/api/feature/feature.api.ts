import type { FeatureDTO } from '../../../backend/modules/feature/feature.schema'
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



  /** To this place among its area's active features, from 0. Another area is a change: it takes a proposal. */
  move(workspaceId: string, featureId: string, position: number) {
    return this.post<FeatureDTO>(`/${workspaceId}/features/${featureId}/move`, { position })
  }


}
