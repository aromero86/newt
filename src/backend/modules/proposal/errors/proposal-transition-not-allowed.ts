import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalTransitionNotAllowed extends ConflictError {
  readonly code = 'proposal.transition_not_allowed'
  constructor(from: string, to: string) {
    super(`A proposal ${from} cannot become ${to}`)
  }
}
