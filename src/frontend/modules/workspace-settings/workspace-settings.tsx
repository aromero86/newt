import { useEffect } from 'react'
import { useParams } from 'react-router'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Provide } from '../../core/injector/provide'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { WorkspaceSettingsGeneral } from './workspace-settings-general/workspace-settings-general'
import { WorkspaceSettingsInvitations } from './workspace-settings-invitations/workspace-settings-invitations'
import { WorkspaceSettingsMembers } from './workspace-settings-members/workspace-settings-members'
import { WorkspaceSettingsService } from './workspace-settings.service'

/** With its own WorkspaceSettingsService: whoever renders it needs nothing else. */
export function WorkspaceSettings() {
  return (
    <Provide services={[WorkspaceSettingsService]}>
      <WorkspaceSettingsWrapped />
    </Provide>
  )
}

function WorkspaceSettingsWrapped() {
  const workspaceId = useParams().workspaceId!
  const settings = useService(WorkspaceSettingsService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const loaded = useValue(settings.members.loaded)
  const admin = workspace?.myRole === 'admin'

  useEffect(() => {
    void settings.load(workspaceId, admin)
  }, [settings, workspaceId, admin])

  return (
    <Stack gap={8}>
      <PageHeader title="Workspace settings" description={workspace?.name} />
      {admin && <WorkspaceSettingsGeneral />}
      {loaded ? <WorkspaceSettingsMembers admin={admin} /> : <Spinner label="Loading the members" />}
      {admin && loaded && <WorkspaceSettingsInvitations />}
    </Stack>
  )
}
