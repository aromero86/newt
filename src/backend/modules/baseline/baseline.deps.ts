import type { Delta_Module } from '../delta/delta.module'
import type { Proposal_Module } from '../proposal/proposal.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'

export interface Baseline_Deps {
  delta: Delta_Module
  proposal: Proposal_Module
  workspaceMember: WorkspaceMember_Module
}
