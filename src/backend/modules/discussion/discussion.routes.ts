import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { DiscussionCommentInputDTO } from '../discussion-comment/discussion-comment.schema'
import type { DiscussionStartDTO } from './discussion'
import type { Discussion_Module } from './discussion.module'

export function registerDiscussionRoutes(base: Base, discussions: Discussion_Module) {
  // The use cases check who may do what and validate every body.
  const onProposal = '/workspaces/:workspaceId/proposals/:key/discussions'
  const one = '/workspaces/:workspaceId/discussions/:discussionId'
  const ids = (request: { params: Record<string, string | undefined> }) => request.params as { workspaceId: string, key: string, discussionId: string }

  // ?deltaId=<id> for the conversations on a delta; without it, on the proposal in general.
  base.http.get(onProposal, async request => {
    const deltaId = new URL(request.url).searchParams.get('deltaId') || null
    return Response.json(await discussions.list(ids(request).workspaceId, ids(request).key, deltaId, pageRequestFrom(request)))
  })

  base.http.get(`${onProposal}/counts`, async request => Response.json(await discussions.counts(ids(request).workspaceId, ids(request).key)))

  base.http.post(onProposal, async request =>
    Response.json(await discussions.start(ids(request).workspaceId, ids(request).key, (await request.json()) as DiscussionStartDTO), { status: 201 }))

  base.http.get(`${one}/comments`, async request =>
    Response.json(await discussions.comments(ids(request).workspaceId, ids(request).discussionId, pageRequestFrom(request))))

  base.http.post(`${one}/comments`, async request =>
    Response.json(await discussions.reply(ids(request).workspaceId, ids(request).discussionId, (await request.json()) as DiscussionCommentInputDTO), { status: 201 }))

  base.http.post(`${one}/resolve`, async request => Response.json(await discussions.resolveDiscussion(ids(request).workspaceId, ids(request).discussionId)))

  base.http.post(`${one}/reopen`, async request => Response.json(await discussions.reopen(ids(request).workspaceId, ids(request).discussionId)))
}
