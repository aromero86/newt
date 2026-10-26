/**
 * What `boards` needs to know of the workspaces, and asks whoever keeps them (auth's
 * tenants and access): a port, in boards' own words, so this module depends on no
 * module of auth. The context is handed one when it opens; a test, a fake.
 */
export type Workspaces = {
  /** Whether someone belongs to a workspace now, deleted it has nobody: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
}

export interface Member_Deps {
  workspaces: Workspaces
}
