import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { FeatureCreateDTO, FeatureMoveDTO, FeatureUpdateDTO } from './feature'
import type { Feature_Module } from './feature.module'

export function registerFeatureRoutes(base: Base, features: Feature_Module) {
  // The use cases check who may do what and validate every body.
  const path = '/workspaces/:workspaceId/features'

  base.http.get('/workspaces/:workspaceId/feature-areas/:areaId/features', async request => {
    const retired = new URL(request.url).searchParams.get('retired') === 'true'
    return Response.json(await features.list(request.params.workspaceId!, request.params.areaId!, retired, pageRequestFrom(request)))
  })

  base.http.post(path, async request =>
    Response.json(await features.create(request.params.workspaceId!, (await request.json()) as FeatureCreateDTO), { status: 201 }))

  base.http.get(`${path}/:featureId`, async request => Response.json(await features.get(request.params.workspaceId!, request.params.featureId!)))

  base.http.patch(`${path}/:featureId`, async request =>
    Response.json(await features.update(request.params.workspaceId!, request.params.featureId!, (await request.json()) as FeatureUpdateDTO)))

  base.http.post(`${path}/:featureId/move`, async request =>
    Response.json(await features.move(request.params.workspaceId!, request.params.featureId!, (await request.json()) as FeatureMoveDTO)))

  base.http.post(`${path}/:featureId/retire`, async request => Response.json(await features.retire(request.params.workspaceId!, request.params.featureId!)))

  base.http.post(`${path}/:featureId/restore`, async request => Response.json(await features.restore(request.params.workspaceId!, request.params.featureId!)))
}
