import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import { MailIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import { SideNav, SideNavItem } from '@cooper/ui/components/side-nav'
import { SidebarLayout } from '@cooper/ui/components/sidebar-layout'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { NotFound } from '../../pages/not-found/not-found'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { WorkspaceSettingsGeneral } from './workspace-settings-general/workspace-settings-general'
import { WorkspaceSettingsInvitations } from './workspace-settings-invitations/workspace-settings-invitations'
import { WorkspaceSettingsMembers } from './workspace-settings-members/workspace-settings-members'

/**
 * A workspace's settings, like a repository's: a menu of sections beside the one
 * shown. Its admin renames, deletes and invites; everyone else sees who is in it.
 */
export function WorkspaceSettings() {
  const workspaceId = useParams().workspaceId!
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const { pathname } = useLocation()
  const admin = workspace?.isAdmin === true
  const base = `/w/${workspaceId}/settings`

  const menu = (
    <SideNav label="Workspace settings">
      {admin && <SideNavItem href={base} active={pathname === base} icon={SettingsIcon}>General</SideNavItem>}
      <SideNavItem href={`${base}/members`} active={pathname.startsWith(`${base}/members`)} icon={UsersIcon}>Members</SideNavItem>
      {admin && <SideNavItem href={`${base}/invitations`} active={pathname.startsWith(`${base}/invitations`)} icon={MailIcon}>Invitations</SideNavItem>}
    </SideNav>
  )

  return (
    <SidebarLayout aside={menu}>
      <Routes>
        <Route index element={admin ? <WorkspaceSettingsGeneral /> : <Navigate to="members" replace />} />
        <Route path="members" element={<WorkspaceSettingsMembers admin={admin} />} />
        {admin && <Route path="invitations" element={<WorkspaceSettingsInvitations />} />}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SidebarLayout>
  )
}
