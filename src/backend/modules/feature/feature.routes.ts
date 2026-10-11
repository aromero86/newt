import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { FeatureMoveDTO } from './feature'
import type { Feature_Module } from './feature.module'

export function registerFeatureRoutes(base: Base, features: Feature_Module) {
  // Reading, and the order within an area: what features there are, and where, changes through proposals.
  const path = '/workspaces/:workspaceId/features'

  base.http.get('/workspaces/:workspaceId/feature-areas/:areaId/features', async request => {
    const retired = new URL(request.url).searchParams.get('retired') === 'true'
    return Response.json(await features.list(request.params.workspaceId!, request.params.areaId!, retired, pageRequestFrom(request)))
  })

  base.http.get(`${path}/:featureId`, async request => Response.json(await features.get(request.params.workspaceId!, request.params.featureId!)))

  // Only the place in its own area: moving it to another area is a change of the definition.
  base.http.post(`${path}/:featureId/move`, async request => {
    const { position } = (await request.json()) as FeatureMoveDTO
    return Response.json(await features.move(request.params.workspaceId!, request.params.featureId!, { position }))
  })
}
