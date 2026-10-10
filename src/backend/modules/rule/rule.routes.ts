import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { RuleFilter } from './rule'
import type { Rule_Module } from './rule.module'

export function registerRuleRoutes(base: Base, rules: Rule_Module) {
  // Only reading: rules are created and changed through use cases, not from the web.
  const path = '/workspaces/:workspaceId/rules'

  // ?featureId=<id>&retired=true&appliesIn=<dimensionId>:<valueId>,<dimensionId>:<valueId>
  base.http.get(path, async request => {
    const params = new URL(request.url).searchParams
    const filter: RuleFilter = {
      featureId: params.get('featureId') || undefined,
      retired: params.get('retired') === 'true',
      appliesIn: (params.get('appliesIn') ?? '').split(',').filter(Boolean).map(pair => {
        const [dimensionId = '', valueId = ''] = pair.split(':')
        return { dimensionId, valueId }
      }),
    }
    return Response.json(await rules.list(request.params.workspaceId!, filter, pageRequestFrom(request)))
  })

  base.http.get(`${path}/:key`, async request => Response.json(await rules.get(request.params.workspaceId!, request.params.key!)))

  base.http.get(`${path}/:key/versions`, async request =>
    Response.json(await rules.versions(request.params.workspaceId!, request.params.key!, pageRequestFrom(request))))
}
