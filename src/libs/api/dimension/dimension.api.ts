import type { DimensionDTO, DimensionNameInputDTO } from '../../../backend/modules/dimension/dimension.schema'
import { Requester } from '../core/requester'

/** The backend's `dimension` module: a workspace's dimensions and their values. */
export class DimensionApi extends Requester {
  protected readonly path = '/workspaces'

  /** Every dimension of the workspace, in order: there are few by design, so no pages. */
  list(workspaceId: string) {
    return this.get<DimensionDTO[]>(`/${workspaceId}/dimensions`)
  }

  create(workspaceId: string, input: DimensionNameInputDTO) {
    return this.post<DimensionDTO>(`/${workspaceId}/dimensions`, input)
  }

  rename(workspaceId: string, dimensionId: string, input: DimensionNameInputDTO) {
    return this.patch<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}`, input)
  }

  /** `order` lists every dimension id once, in the new order. */
  reorder(workspaceId: string, order: string[]) {
    return this.put<DimensionDTO[]>(`/${workspaceId}/dimensions/order`, { order })
  }

  addValue(workspaceId: string, dimensionId: string, input: DimensionNameInputDTO) {
    return this.post<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}/values`, input)
  }

  renameValue(workspaceId: string, dimensionId: string, valueId: string, input: DimensionNameInputDTO) {
    return this.patch<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}/values/${valueId}`, input)
  }

  /** `order` lists every value id of the dimension once, retired ones included. */
  reorderValues(workspaceId: string, dimensionId: string, order: string[]) {
    return this.put<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}/values/order`, { order })
  }

  retireValue(workspaceId: string, dimensionId: string, valueId: string) {
    return this.post<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}/values/${valueId}/retire`)
  }

  restoreValue(workspaceId: string, dimensionId: string, valueId: string) {
    return this.post<DimensionDTO>(`/${workspaceId}/dimensions/${dimensionId}/values/${valueId}/restore`)
  }
}
