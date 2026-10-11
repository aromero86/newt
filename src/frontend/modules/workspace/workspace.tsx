import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router'
import { PageBody } from '@newt/ui/components/page-body'
import { Spinner } from '@newt/ui/components/spinner'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { NotFound } from '../../pages/not-found/not-found'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { WorkspaceBand } from './workspace-band/workspace-band'

/** Everything under /w/:workspaceId, below its band: only for its members, and remembered as the last one opened. */
export function Workspace() {
  const workspaceId = useParams().workspaceId!
  const workspaces = useService(WorkspacesService)
  const workspace = useValue(workspaces.workspace(workspaceId))

  useEffect(() => {
    void workspaces.open(workspaceId)
  }, [workspaces, workspaceId])

  useEffect(() => {
    if (workspace) workspaces.rememberVisit(workspace.id)
  }, [workspaces, workspace])

  if (workspace === undefined) return <PageBody><Spinner label="Loading the workspace" /></PageBody>
  // Not a member, or no such workspace: the same answer, as the backend gives.
  if (workspace === null) return <PageBody><NotFound /></PageBody>
  return (
    <>
      <WorkspaceBand workspace={workspace} />
      <PageBody>
        <Outlet />
      </PageBody>
    </>
  )
}
