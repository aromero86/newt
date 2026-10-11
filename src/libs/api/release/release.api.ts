import type { ReleaseChangeDTO, ReleaseDocumentDTO, ReleaseDTO, ReleasePublishDTO } from '../../../backend/modules/release/release.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `release` module: releases, what changed between them, and the documents. */
export class ReleaseApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of releases, newest first. */
  list(workspaceId: string, page?: PageRequest) {
    return this.get<Page<ReleaseDTO>>(`/${workspaceId}/releases`, page)
  }

  one(workspaceId: string, name: string) {
    return this.get<ReleaseDTO>(`/${workspaceId}/releases/${encodeURIComponent(name)}`)
  }

  publish(workspaceId: string, input: ReleasePublishDTO) {
    return this.post<ReleaseDTO>(`/${workspaceId}/releases`, input)
  }

  /** A page of what changed since the last release. */
  unpublished(workspaceId: string, page?: PageRequest) {
    return this.get<Page<ReleaseChangeDTO>>(`/${workspaceId}/releases/unpublished`, page)
  }

  /** A page of what a release changed since the one before it. */
  changes(workspaceId: string, name: string, page?: PageRequest) {
    return this.get<Page<ReleaseChangeDTO>>(`/${workspaceId}/releases/${encodeURIComponent(name)}/changes`, page)
  }

  /** The definition as a Markdown document: as a release left it, or as it is now. */
  specification(workspaceId: string, release?: string) {
    return this.get<ReleaseDocumentDTO>(`/${workspaceId}/releases/specification`, { release })
  }

  /** What changed, newest first, as a Markdown document; down to `since`, or all of it. */
  changelog(workspaceId: string, since?: string) {
    return this.get<ReleaseDocumentDTO>(`/${workspaceId}/releases/changelog`, { since })
  }
}
