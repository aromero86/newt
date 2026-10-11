import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { DeltaInputDTO, DeltaReviewInputDTO } from '../delta/delta.schema'
import { ProposalStatusSchema, type ProposalCreateDTO, type ProposalQuickDTO, type ProposalUpdateDTO } from './proposal'
import type { Proposal_Module } from './proposal.module'

export function registerProposalRoutes(base: Base, proposals: Proposal_Module) {
  // The use cases check who may do what and validate every body.
  const path = '/workspaces/:workspaceId/proposals'
  const one = `${path}/:key`
  const delta = `${one}/deltas/:deltaId`
  const ids = (request: { params: Record<string, string | undefined> }) =>
    request.params as { workspaceId: string, key: string, deltaId: string }

  // ?status=draft,in review
  base.http.get(path, async request => {
    const status = (new URL(request.url).searchParams.get('status') ?? '').split(',').filter(Boolean).map(each => ProposalStatusSchema.parse(each))
    return Response.json(await proposals.list(ids(request).workspaceId, status.length ? status : undefined, pageRequestFrom(request)))
  })

  base.http.post(path, async request =>
    Response.json(await proposals.create(ids(request).workspaceId, (await request.json()) as ProposalCreateDTO), { status: 201 }))

  base.http.post(`${path}/quick`, async request =>
    Response.json(await proposals.quick(ids(request).workspaceId, (await request.json()) as ProposalQuickDTO), { status: 201 }))

  base.http.get(one, async request => Response.json(await proposals.get(ids(request).workspaceId, ids(request).key)))

  base.http.patch(one, async request =>
    Response.json(await proposals.update(ids(request).workspaceId, ids(request).key, (await request.json()) as ProposalUpdateDTO)))

  for (const [action, run] of [
    ['submit', proposals.submit],
    ['draft', proposals.backToDraft],
    ['accept', proposals.accept],
    ['reopen', proposals.reopen],
    ['merge', proposals.merge],
    ['discard', proposals.discard],
  ] as const) {
    base.http.post(`${one}/${action}`, async request => Response.json(await run.call(proposals, ids(request).workspaceId, ids(request).key)))
  }

  base.http.get(`${one}/deltas`, async request =>
    Response.json(await proposals.deltas(ids(request).workspaceId, ids(request).key, pageRequestFrom(request))))

  base.http.post(`${one}/deltas`, async request =>
    Response.json(await proposals.addDelta(ids(request).workspaceId, ids(request).key, (await request.json()) as DeltaInputDTO), { status: 201 }))

  base.http.put(delta, async request => {
    const { workspaceId, key, deltaId } = ids(request)
    return Response.json(await proposals.rewriteDelta(workspaceId, key, deltaId, (await request.json()) as DeltaInputDTO))
  })

  base.http.delete(delta, async request => {
    const { workspaceId, key, deltaId } = ids(request)
    await proposals.removeDelta(workspaceId, key, deltaId)
    return new Response(null, { status: 204 })
  })

  base.http.post(`${delta}/review`, async request => {
    const { workspaceId, key, deltaId } = ids(request)
    return Response.json(await proposals.reviewDelta(workspaceId, key, deltaId, (await request.json()) as DeltaReviewInputDTO))
  })

  base.http.delete(`${delta}/review`, async request => {
    const { workspaceId, key, deltaId } = ids(request)
    return Response.json(await proposals.withdrawReview(workspaceId, key, deltaId))
  })
}
