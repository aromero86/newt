import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import { SearchKindSchema } from './search.schema'
import type { Search_Module } from './search.module'

export function registerSearchRoutes(base: Base, search: Search_Module) {
  // ?query=…&kind=rule,feature&featureId=…&appliesIn=<dimensionId>:<valueId>,…&definition=planned&history=true
  base.http.get('/workspaces/:workspaceId/search', async request => {
    const params = new URL(request.url).searchParams
    const list = (name: string) => (params.get(name) ?? '').split(',').filter(Boolean)
    const kinds = list('kind').map(kind => SearchKindSchema.parse(kind))
    return Response.json(await search.search(request.params.workspaceId!, {
      query: params.get('query') ?? '',
      kinds: kinds.length ? kinds : undefined,
      featureId: params.get('featureId') || undefined,
      appliesIn: list('appliesIn').map(pair => {
        const [dimensionId = '', valueId = ''] = pair.split(':')
        return { dimensionId, valueId }
      }),
      definition: params.get('definition') === 'planned' ? 'planned' : 'in force',
      history: params.get('history') === 'true',
    }, pageRequestFrom(request)))
  })

  // ?targetId=<id>: what talks about the same as that artifact.
  base.http.get('/workspaces/:workspaceId/search/similar', async request => {
    const targetId = new URL(request.url).searchParams.get('targetId') ?? ''
    return Response.json(await search.similar(request.params.workspaceId!, targetId, pageRequestFrom(request)))
  })
}
