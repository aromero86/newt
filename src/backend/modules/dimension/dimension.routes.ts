import type { BunRequest } from 'bun'
import type { Base } from '../../base/base'
import type { DimensionNameInputDTO, DimensionOrderDTO } from './dimension'
import type { Dimension_Module } from './dimension.module'

export function registerDimensionRoutes(base: Base, dimensions: Dimension_Module) {
  // The use cases check who may do what and validate every body.
  const ids = (request: BunRequest) => request.params as { workspaceId: string, dimensionId: string, valueId: string }
  const path = '/workspaces/:workspaceId/dimensions'

  base.http.get(path, async request => Response.json(await dimensions.list(ids(request).workspaceId)))

  base.http.post(path, async request =>
    Response.json(await dimensions.create(ids(request).workspaceId, (await request.json()) as DimensionNameInputDTO), { status: 201 }))

  base.http.put(`${path}/order`, async request =>
    Response.json(await dimensions.reorder(ids(request).workspaceId, (await request.json()) as DimensionOrderDTO)))

  base.http.patch(`${path}/:dimensionId`, async request => {
    const { workspaceId, dimensionId } = ids(request)
    return Response.json(await dimensions.rename(workspaceId, dimensionId, (await request.json()) as DimensionNameInputDTO))
  })

  base.http.post(`${path}/:dimensionId/values`, async request => {
    const { workspaceId, dimensionId } = ids(request)
    return Response.json(await dimensions.addValue(workspaceId, dimensionId, (await request.json()) as DimensionNameInputDTO), { status: 201 })
  })

  base.http.put(`${path}/:dimensionId/values/order`, async request => {
    const { workspaceId, dimensionId } = ids(request)
    return Response.json(await dimensions.reorderValues(workspaceId, dimensionId, (await request.json()) as DimensionOrderDTO))
  })

  base.http.patch(`${path}/:dimensionId/values/:valueId`, async request => {
    const { workspaceId, dimensionId, valueId } = ids(request)
    return Response.json(await dimensions.renameValue(workspaceId, dimensionId, valueId, (await request.json()) as DimensionNameInputDTO))
  })

  base.http.post(`${path}/:dimensionId/values/:valueId/retire`, async request => {
    const { workspaceId, dimensionId, valueId } = ids(request)
    return Response.json(await dimensions.retireValue(workspaceId, dimensionId, valueId))
  })

  base.http.post(`${path}/:dimensionId/values/:valueId/restore`, async request => {
    const { workspaceId, dimensionId, valueId } = ids(request)
    return Response.json(await dimensions.restoreValue(workspaceId, dimensionId, valueId))
  })
}
