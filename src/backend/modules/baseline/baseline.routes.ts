import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { Baseline_Module } from './baseline.module'

export function registerBaselineRoutes(base: Base, baseline: Baseline_Module) {
  // ?targetId=<id>,<id>: only the changes planned for these artifacts.
  base.http.get('/workspaces/:workspaceId/baseline/planned', async request => {
    const targetIds = (new URL(request.url).searchParams.get('targetId') ?? '').split(',').filter(Boolean)
    return Response.json(await baseline.planned(request.params.workspaceId!, targetIds.length ? targetIds : undefined, pageRequestFrom(request)))
  })
}
