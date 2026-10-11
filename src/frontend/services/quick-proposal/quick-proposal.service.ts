import { ProposalApi, type DeltaInputDTO, type ProposalDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { inject } from '../../core/injector/inject'

/**
 * Proposes one change made in place: a quick proposal with that single delta, in
 * review at once. Nothing in the definition changes until it is merged.
 */
export class QuickProposalService {

  private readonly api = inject(ProposalApi)

  /** Resolves to the new proposal, or to undefined after saying why it could not be made. */
  async propose(workspaceId: string, delta: DeltaInputDTO): Promise<ProposalDTO | undefined> {
    try {
      const proposal = await this.api.quick(workspaceId, delta)
      toast.success(`${proposal.key} proposed: it is in review`, { description: proposal.title })
      return proposal
    } catch (error) {
      toast.error((error as Error).message)
      return undefined
    }
  }
}
