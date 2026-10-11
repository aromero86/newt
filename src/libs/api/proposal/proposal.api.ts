import type { DeltaDTO, DeltaInputDTO, DeltaReviewInputDTO } from '../../../backend/modules/delta/delta.schema'
import type { ProposalDTO, ProposalStatus } from '../../../backend/modules/proposal/proposal.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** What moves a proposal along its lifecycle. */
export type ProposalAction = 'submit' | 'draft' | 'accept' | 'reopen' | 'merge' | 'discard'

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

  /** A page of its deltas, in the order they will be applied. */
  deltas(workspaceId: string, key: string, page?: PageRequest) {
    return this.get<Page<DeltaDTO>>(`/${workspaceId}/proposals/${key}/deltas`, page)
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

  review(workspaceId: string, key: string, deltaId: string, review: DeltaReviewInputDTO) {
    return this.post<DeltaDTO>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}/review`, review)
  }

  /** Takes back the signed-in person's verdict. */
  withdrawReview(workspaceId: string, key: string, deltaId: string) {
    return this.delete<DeltaDTO>(`/${workspaceId}/proposals/${key}/deltas/${deltaId}/review`)
  }
}
