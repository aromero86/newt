import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router'
import { Spinner } from '@newt/ui/components/spinner'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { NotFound } from '../../pages/not-found/not-found'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Everything under /w/:workspaceId: only for its members, and remembered as the last one opened. */
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

  if (workspace === undefined) return <Spinner label="Loading the workspace" />
  // Not a member, or no such workspace: the same answer, as the backend gives.
  if (workspace === null) return <NotFound />
  return <Outlet />
}
