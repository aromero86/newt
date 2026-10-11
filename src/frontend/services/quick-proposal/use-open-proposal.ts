import { useNavigate } from 'react-router'
import type { ProposalDTO } from '@newt/api/proposal'

/** Waits for a proposal being made and, if it was, opens it: there it is approved. */
export function useOpenProposal() {
  const navigate = useNavigate()
  return async (proposing: Promise<ProposalDTO | undefined>) => {
    const proposal = await proposing
    if (proposal) navigate(`/w/${proposal.workspaceId}/proposals/${proposal.key}`)
  }
}
