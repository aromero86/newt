import { useEffect } from 'react'
import { Navigate } from 'react-router'
import { Spinner } from '@newt/ui/components/spinner'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** newt opens in the workspace the person was last in, or in the list of their workspaces. */
export function Home() {
  const workspaces = useService(WorkspacesService)
  const last = workspaces.lastVisited()
  const workspace = useValue(workspaces.workspace(last ?? ''))

  useEffect(() => {
    if (last) void workspaces.open(last)
  }, [workspaces, last])

  if (!last || workspace === null) return <Navigate to="/workspaces" replace />
  if (workspace === undefined) return <Spinner label="Opening your workspace" />
  return <Navigate to={`/w/${workspace.id}`} replace />
}
