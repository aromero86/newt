import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { FeatureAreaCreateDTO, FeatureAreaMoveDTO, FeatureAreaUpdateDTO } from './feature-area'
import type { FeatureArea_Module } from './feature-area.module'

export function registerFeatureAreaRoutes(base: Base, areas: FeatureArea_Module) {
  // The use cases check who may do what and validate every body.
  const path = '/workspaces/:workspaceId/feature-areas'

  base.http.get(path, async request => {
    const retired = new URL(request.url).searchParams.get('retired') === 'true'
    return Response.json(await areas.list(request.params.workspaceId!, retired, pageRequestFrom(request)))
  })

  base.http.post(path, async request =>
    Response.json(await areas.create(request.params.workspaceId!, (await request.json()) as FeatureAreaCreateDTO), { status: 201 }))

  base.http.get(`${path}/:areaId`, async request => Response.json(await areas.get(request.params.workspaceId!, request.params.areaId!)))

  base.http.patch(`${path}/:areaId`, async request =>
    Response.json(await areas.update(request.params.workspaceId!, request.params.areaId!, (await request.json()) as FeatureAreaUpdateDTO)))

  base.http.post(`${path}/:areaId/move`, async request =>
    Response.json(await areas.move(request.params.workspaceId!, request.params.areaId!, (await request.json()) as FeatureAreaMoveDTO)))

  base.http.post(`${path}/:areaId/retire`, async request => Response.json(await areas.retire(request.params.workspaceId!, request.params.areaId!)))

  base.http.post(`${path}/:areaId/restore`, async request => Response.json(await areas.restore(request.params.workspaceId!, request.params.areaId!)))
}
