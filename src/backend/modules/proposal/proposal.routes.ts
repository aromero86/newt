import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import { DeltaViewSchema, type DeltaInputDTO, type DeltaReviewInputDTO } from '../delta/delta.schema'
import {
  ProposalStatusSchema,
  type ProposalCreateDTO,
  type ProposalDocumentInputDTO,
  type ProposalPublishDTO,
  type ProposalQuickDTO,
  type ProposalSubmitDTO,
  type ProposalUpdateDTO,
} from './proposal'
import type { Proposal_Module } from './proposal.module'

export function registerProposalRoutes(base: Base, proposals: Proposal_Module) {
  // The use cases check who may do what and validate every body.
  const path = '/workspaces/:workspaceId/proposals'
  const one = `${path}/:key`
  const delta = `${one}/deltas/:deltaId`
  const ids = (request: { params: Record<string, string | undefined> }) =>
    request.params as { workspaceId: string, key: string, deltaId: string, number: string }
  const query = (request: Request) => new URL(request.url).searchParams

  // ?status=draft,in review&title=checkout
  base.http.get(path, async request => {
    const status = (query(request).get('status') ?? '').split(',').filter(Boolean).map(each => ProposalStatusSchema.parse(each))
    const title = query(request).get('title') || undefined
    return Response.json(await proposals.list(ids(request).workspaceId, { status: status.length ? status : undefined, title }, pageRequestFrom(request)))
  })

  base.http.post(path, async request =>
    Response.json(await proposals.create(ids(request).workspaceId, (await request.json()) as ProposalCreateDTO), { status: 201 }))

  base.http.post(`${path}/quick`, async request =>
    Response.json(await proposals.quick(ids(request).workspaceId, (await request.json()) as ProposalQuickDTO), { status: 201 }))

  base.http.get(one, async request => Response.json(await proposals.get(ids(request).workspaceId, ids(request).key)))

  base.http.patch(one, async request =>
    Response.json(await proposals.update(ids(request).workspaceId, ids(request).key, (await request.json()) as ProposalUpdateDTO)))

  base.http.put(`${one}/document`, async request =>
    Response.json(await proposals.writeDocument(ids(request).workspaceId, ids(request).key, (await request.json()) as ProposalDocumentInputDTO)))

  base.http.post(`${one}/publish`, async request =>
    Response.json(await proposals.publish(ids(request).workspaceId, ids(request).key, (await request.json()) as ProposalPublishDTO)))

  base.http.post(`${one}/discard-changes`, async request => Response.json(await proposals.discardChanges(ids(request).workspaceId, ids(request).key)))

  base.http.post(`${one}/submit`, async request =>
    Response.json(await proposals.submit(ids(request).workspaceId, ids(request).key, (await request.json().catch(() => ({}))) as ProposalSubmitDTO)))

  base.http.post(`${one}/draft`, async request => Response.json(await proposals.backToDraft(ids(request).workspaceId, ids(request).key)))
  base.http.post(`${one}/accept`, async request => Response.json(await proposals.accept(ids(request).workspaceId, ids(request).key)))
  base.http.post(`${one}/reopen`, async request => Response.json(await proposals.reopen(ids(request).workspaceId, ids(request).key)))
  base.http.post(`${one}/merge`, async request => Response.json(await proposals.merge(ids(request).workspaceId, ids(request).key)))
  base.http.post(`${one}/discard`, async request => Response.json(await proposals.discard(ids(request).workspaceId, ids(request).key)))

  base.http.get(`${one}/revisions`, async request =>
    Response.json(await proposals.revisions(ids(request).workspaceId, ids(request).key, pageRequestFrom(request))))

  base.http.get(`${one}/revisions/:number`, async request =>
    Response.json(await proposals.revision(ids(request).workspaceId, ids(request).key, Number(ids(request).number))))

  base.http.get(`${one}/revisions/:number/deltas`, async request =>
    Response.json(await proposals.revisionDeltas(ids(request).workspaceId, ids(request).key, Number(ids(request).number), pageRequestFrom(request))))

  // ?from=1&to=3
  base.http.get(`${one}/compare`, async request =>
    Response.json(await proposals.compare(ids(request).workspaceId, ids(request).key, Number(query(request).get('from')), Number(query(request).get('to')), pageRequestFrom(request))))

  // ?view=published (what reviewers see, by default) or working
  base.http.get(`${one}/deltas`, async request => {
    const view = DeltaViewSchema.parse(query(request).get('view') ?? 'published')
    return Response.json(await proposals.deltas(ids(request).workspaceId, ids(request).key, view, pageRequestFrom(request)))
  })

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

  base.http.post(`${delta}/undo-remove`, async request => {
    const { workspaceId, key, deltaId } = ids(request)
    await proposals.undoRemoveDelta(workspaceId, key, deltaId)
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
