import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router'
import { RotateCcwIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { PageBody } from 'newt-kit-react-ui/page-body'
import { Spinner } from 'newt-kit-react-ui/spinner'
import { Stack } from 'newt-kit-react-ui/stack'
import { Provide, useService, useValue } from 'newt-kit-react'
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
  const loading = useValue(workspaces.loading)

  useEffect(() => {
    void workspaces.load()
  }, [workspaces])

  // Once it is known to be theirs; a rename does not read the members again.
  const known = Boolean(workspace)
  useEffect(() => {
    if (known) void service.load(workspaceId)
  }, [service, workspaceId, known])

  if (workspace === undefined && !failure) return <PageBody><Spinner label="Loading the workspace" /></PageBody>
  // The list could not be read: whether it is theirs is not known yet.
  if (workspace === undefined) {
    return (
      <PageBody>
        <Stack gap={3} align="start">
          <Alert tone="bad" title="Could not load your workspaces">{failure}</Alert>
          <Button size="sm" variant="outline" loading={loading} onClick={() => void workspaces.reload()}>
            <Icon icon={RotateCcwIcon} size="sm" />Retry
          </Button>
        </Stack>
      </PageBody>
    )
  }
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
