import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { ReleasePublishDTO } from './release'
import type { Release_Module } from './release.module'

export function registerReleaseRoutes(base: Base, releases: Release_Module) {
  // The use cases check who may do what and validate every body.
  const path = '/workspaces/:workspaceId/releases'
  const ids = (request: { params: Record<string, string | undefined> }) => request.params as { workspaceId: string, name: string }

  base.http.get(path, async request => Response.json(await releases.list(ids(request).workspaceId, pageRequestFrom(request))))

  base.http.post(path, async request =>
    Response.json(await releases.publish(ids(request).workspaceId, (await request.json()) as ReleasePublishDTO), { status: 201 }))

  // What the next release would publish.
  base.http.get(`${path}/unpublished`, async request => Response.json(await releases.unpublished(ids(request).workspaceId, pageRequestFrom(request))))

  // The definition in force as a document; ?release=<name> for how a release left it.
  base.http.get(`${path}/specification`, async request =>
    Response.json(await releases.specification(ids(request).workspaceId, new URL(request.url).searchParams.get('release'))))

  // What changed, newest first; ?since=<name> to stop at that release.
  base.http.get(`${path}/changelog`, async request =>
    Response.json(await releases.changelog(ids(request).workspaceId, new URL(request.url).searchParams.get('since'))))

  base.http.get(`${path}/:name`, async request => Response.json(await releases.get(ids(request).workspaceId, decodeURIComponent(ids(request).name))))

  base.http.get(`${path}/:name/changes`, async request =>
    Response.json(await releases.changes(ids(request).workspaceId, decodeURIComponent(ids(request).name), pageRequestFrom(request))))
}
