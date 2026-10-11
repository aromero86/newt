import type { BunRequest } from 'bun'
import type { Base } from '../../base/base'
import type { DimensionOrderDTO } from './dimension'
import type { Dimension_Module } from './dimension.module'

export function registerDimensionRoutes(base: Base, dimensions: Dimension_Module) {
  // Reading, and the order: what dimensions and values there are changes through proposals.
  const ids = (request: BunRequest) => request.params as { workspaceId: string, dimensionId: string }
  const path = '/workspaces/:workspaceId/dimensions'

  base.http.get(path, async request => Response.json(await dimensions.list(ids(request).workspaceId)))

  base.http.put(`${path}/order`, async request =>
    Response.json(await dimensions.reorder(ids(request).workspaceId, (await request.json()) as DimensionOrderDTO)))

  base.http.put(`${path}/:dimensionId/values/order`, async request => {
    const { workspaceId, dimensionId } = ids(request)
    return Response.json(await dimensions.reorderValues(workspaceId, dimensionId, (await request.json()) as DimensionOrderDTO))
  })
}
