import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { FeatureAreaMoveDTO } from './feature-area'
import type { FeatureArea_Module } from './feature-area.module'

export function registerFeatureAreaRoutes(base: Base, areas: FeatureArea_Module) {
  // Reading, and the order: what areas there are changes through proposals.
  const path = '/workspaces/:workspaceId/feature-areas'

  base.http.get(path, async request => {
    const retired = new URL(request.url).searchParams.get('retired') === 'true'
    return Response.json(await areas.list(request.params.workspaceId!, retired, pageRequestFrom(request)))
  })

  base.http.get(`${path}/:areaId`, async request => Response.json(await areas.get(request.params.workspaceId!, request.params.areaId!)))

  base.http.post(`${path}/:areaId/move`, async request =>
    Response.json(await areas.move(request.params.workspaceId!, request.params.areaId!, (await request.json()) as FeatureAreaMoveDTO)))
}
