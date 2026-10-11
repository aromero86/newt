import type { DimensionDTO } from '../../../backend/modules/dimension/dimension.schema'
import { Requester } from '../core/requester'

/** The backend's `dimension` module: a workspace's dimensions and their values. */
export class DimensionApi extends Requester {
  protected readonly path = '/workspaces'

  /** Every dimension of the workspace, in order: there are few by design, so no pages. */
  list(workspaceId: string) {
    return this.get<DimensionDTO[]>(`/${workspaceId}/dimensions`)
  }



  /** `order` lists every dimension id once, in the new order. */
  reorder(workspaceId: string, order: string[]) {
    return this.put<DimensionDTO[]>(`/${workspaceId}/dimensions/order`, { order })
  }



  /** `order` lists every value id of the dimension once, retired ones included. */
  reorderValues(workspaceId: string, dimensionId: string, order: string[]) {
    return this.put<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}/values/order`, { order })
  }


}
