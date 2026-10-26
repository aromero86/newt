import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Job_Deps } from './job.deps'
import type { Job_Module } from './job.module'
import type { JobContext } from './job.schema'

export function registerJobRoutes(base: CooperBase, jobs: Job_Module, deps: Job_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `/jobs/boards`: boards' dead jobs. A context that is not one is a 400.
  routes.get('/jobs/:context', async request =>
    Response.json(await jobs.dead(request.params.context as JobContext, pageRequestFrom(request))))

  routes.post('/jobs/:context/:jobId/retry', async request => {
    await jobs.retry(request.params.context as JobContext, request.params.jobId)
    return new Response(null, { status: 204 })
  })
}
