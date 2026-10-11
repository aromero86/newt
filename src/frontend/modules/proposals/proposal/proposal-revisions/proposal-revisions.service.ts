import { ProposalApi, type ProposalRevisionDTO } from '@newt/api/proposal'
import { inject } from '../../../../core/injector/inject'
import { ListStore } from '../../../../core/list/list-store'
import { ProposalService } from '../proposal.service'

/** A proposal's revisions, newest first. */
export class ProposalRevisionsService {

  private readonly api = inject(ProposalApi)
  private readonly proposal = inject(ProposalService)

  readonly revisions = new ListStore<ProposalRevisionDTO>(page => this.api.revisions(this.proposal.workspaceId, this.proposal.key, page))
}
