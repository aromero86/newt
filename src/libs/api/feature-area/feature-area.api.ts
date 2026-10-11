import type { FeatureAreaDTO } from '../../../backend/modules/feature-area/feature-area.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `feature-area` module: the areas a workspace groups its features in. */
export class FeatureAreaApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the active areas, in their order; with `retired`, of the retired ones. */
  list(workspaceId: string, page?: PageRequest, retired = false) {
    return this.get<Page<FeatureAreaDTO>>(`/${workspaceId}/feature-areas`, { ...page, ...(retired ? { retired: 'true' } : {}) })
  }

  one(workspaceId: string, areaId: string) {
    return this.get<FeatureAreaDTO>(`/${workspaceId}/feature-areas/${areaId}`)
  }



  /** To this place among the active areas, from 0. */
  move(workspaceId: string, areaId: string, position: number) {
    return this.post<FeatureAreaDTO>(`/${workspaceId}/feature-areas/${areaId}/move`, { position })
  }


}
