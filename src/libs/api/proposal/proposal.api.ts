import type { DeltaComparisonDTO, DeltaDTO, DeltaInputDTO, DeltaReviewInputDTO, DeltaSnapshotDTO, DeltaView } from '../../../backend/modules/delta/delta.schema'
import type { ProposalDTO, ProposalRevisionDTO, ProposalStatus } from '../../../backend/modules/proposal/proposal.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** What moves a proposal along its lifecycle. Sending to review is `submit`, which may publish a revision. */
export type ProposalAction = 'draft' | 'accept' | 'reopen' | 'merge' | 'discard'

/** The backend's `proposal` module: proposals, their lifecycle and their deltas. */
export class ProposalApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of proposals, newest first; only those in `status`, if given. */
  list(workspaceId: string, status?: ProposalStatus[], page?: PageRequest) {
    return this.get<Page<ProposalDTO>>(`/${workspaceId}/proposals`, { ...page, status: status?.length ? status.join(',') : undefined })
  }

  one(workspaceId: string, key: string) {
    return this.get<ProposalDTO>(`/${workspaceId}/proposals/${key}`)
  }

  create(workspaceId: string, title: string) {
    return this.post<ProposalDTO>(`/${workspaceId}/proposals`, { title })
  }

  /** One change made in place: a proposal in review with that single delta. */
  quick(workspaceId: string, delta: DeltaInputDTO) {
    return this.post<ProposalDTO>(`/${workspaceId}/proposals/quick`, { delta })
  }

  retitle(workspaceId: string, key: string, title: string) {
    return this.patch<ProposalDTO>(`/${workspaceId}/proposals/${key}`, { title })
  }

  act(workspaceId: string, key: string, action: ProposalAction) {
    return this.post<ProposalDTO>(`/${workspaceId}/proposals/${key}/${action}`)
  }

  /** To review. Changes not published yet go in a revision with this message. */
  submit(workspaceId: string, key: string, message?: string) {
    return this.post<ProposalDTO>(`/${workspaceId}/proposals/${key}/submit`, { message })
  }

  /** Saves the working copy of the document: no revision, and reviewers do not see it. */
  writeDocument(workspaceId: string, key: string, document: string) {
    return this.put<ProposalDTO>(`/${workspaceId}/proposals/${key}/document`, { document })
  }

  /** Publishes the working copy as the next revision. */
  publish(workspaceId: string, key: string, message: string) {
    return this.post<ProposalDTO>(`/${workspaceId}/proposals/${key}/publish`, { message })
  }

  /** The working copy goes back to the last revision. */
  discardChanges(workspaceId: string, key: string) {
    return this.post<ProposalDTO>(`/${workspaceId}/proposals/${key}/discard-changes`)
  }

  /** A page of its revisions, newest first. */
  revisions(workspaceId: string, key: string, page?: PageRequest) {
    return this.get<Page<ProposalRevisionDTO>>(`/${workspaceId}/proposals/${key}/revisions`, page)
  }

  revision(workspaceId: string, key: string, number: number) {
    return this.get<ProposalRevisionDTO>(`/${workspaceId}/proposals/${key}/revisions/${number}`)
  }

  /** A page of what a revision did to the deltas. */
  revisionDeltas(workspaceId: string, key: string, number: number, page?: PageRequest) {
    return this.get<Page<DeltaSnapshotDTO>>(`/${workspaceId}/proposals/${key}/revisions/${number}/deltas`, page)
  }

  /** A page of the deltas of two revisions, with what each said in one and the other. */
  compare(workspaceId: string, key: string, from: number, to: number, page?: PageRequest) {
    return this.get<Page<DeltaComparisonDTO>>(`/${workspaceId}/proposals/${key}/compare`, { ...page, from, to })
  }

  /** A page of its deltas: as the last revision published them, or as they are being written. */
  deltas(workspaceId: string, key: string, view: DeltaView, page?: PageRequest) {
    return this.get<Page<DeltaDTO>>(`/${workspaceId}/proposals/${key}/deltas`, { ...page, view })
  }

  addDelta(workspaceId: string, key: string, delta: DeltaInputDTO) {
    return this.post<DeltaDTO>(`/${workspaceId}/proposals/${key}/deltas`, delta)
  }

  rewriteDelta(workspaceId: string, key: string, deltaId: string, delta: DeltaInputDTO) {
    return this.put<DeltaDTO>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}`, delta)
  }

  removeDelta(workspaceId: string, key: string, deltaId: string) {
    return this.delete<void>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}`)
  }

  /** Back into the working copy, before a revision publishes its removal. */
  undoRemoveDelta(workspaceId: string, key: string, deltaId: string) {
    return this.post<void>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}/undo-remove`)
  }

  review(workspaceId: string, key: string, deltaId: string, review: DeltaReviewInputDTO) {
    return this.post<DeltaDTO>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}/review`, review)
  }

  /** Takes back the signed-in person's verdict. */
  withdrawReview(workspaceId: string, key: string, deltaId: string) {
    return this.delete<DeltaDTO>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}/review`)
  }
}
