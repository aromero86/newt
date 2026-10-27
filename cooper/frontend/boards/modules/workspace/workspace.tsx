import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router'
import { PageBody } from 'newt-react-ui/page-body'
import { Spinner } from 'newt-react-ui/spinner'
import { Provide, useService, useValue } from 'newt-react'
import { NotFound } from '../../pages/not-found/not-found'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { WorkspaceBand } from './workspace-band/workspace-band'
import { WorkspaceService } from './workspace.service'

/** With its own WorkspaceService: whoever renders it needs nothing else. */
export function Workspace() {
  return (
    <Provide services={[WorkspaceService]}>
      <WorkspaceWrapped />
    </Provide>
  )
}

/** Everything under /w/:workspaceId, below its band: only for its members. */
function WorkspaceWrapped() {
  const workspaceId = useParams().workspaceId!
  const workspaces = useService(WorkspacesService)
  const service = useService(WorkspaceService)
  const workspace = useValue(workspaces.workspace(workspaceId))
  const failure = useValue(workspaces.failure)

  useEffect(() => {
    void workspaces.load()
  }, [workspaces])

  // Once it is known to be theirs; a rename does not read the members again.
  const known = Boolean(workspace)
  useEffect(() => {
    if (known) void service.load(workspaceId)
  }, [service, workspaceId, known])

  if (workspace === undefined && !failure) return <PageBody><Spinner label="Loading the workspace" /></PageBody>
  // Not a member, or no such workspace: the same answer, as the backend gives.
  if (!workspace) return <PageBody><NotFound /></PageBody>
  return (
    <>
      <WorkspaceBand workspace={workspace} />
      <PageBody>
        <Outlet />
      </PageBody>
    </>
  )
}
