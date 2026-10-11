import type { Delta_Module } from '../delta/delta.module'
import type { Extraction_Module } from '../extraction/extraction.module'
import type { User_Module } from '../user/user.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface Proposal_Deps {
  delta: Delta_Module
  extraction: Extraction_Module
  user: User_Module
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
}
