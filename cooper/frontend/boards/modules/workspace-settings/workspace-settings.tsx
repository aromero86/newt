import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import { MailIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import { SideNav, SideNavItem } from 'newt-kit-react-ui/side-nav'
import { SidebarLayout } from 'newt-kit-react-ui/sidebar-layout'
import { useService, useValue } from 'newt-kit-react'
import { NotFound } from '../../pages/not-found/not-found'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { WorkspaceSettingsGeneral } from './workspace-settings-general/workspace-settings-general'
import { WorkspaceSettingsInvitations } from './workspace-settings-invitations/workspace-settings-invitations'
import { WorkspaceSettingsMembers } from './workspace-settings-members/workspace-settings-members'

/**
 * A workspace's settings, like a repository's: its admin gets a menu of sections
 * beside the one shown, to rename, delete, invite and remove. Everyone else only has
 * the members (who is in it, and leaving), with no menu to admin-only pages.
 */
export function WorkspaceSettings() {
  const workspaceId = useParams().workspaceId!
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const { pathname } = useLocation()
  const base = `/w/${workspaceId}/settings`

  if (workspace?.isAdmin !== true) {
    return (
      <Routes>
        <Route index element={<Navigate to="members" replace />} />
        <Route path="members" element={<WorkspaceSettingsMembers admin={false} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    )
  }

  const sections = [
    { href: base, label: 'General', icon: SettingsIcon, active: pathname === base },
    { href: `${base}/members`, label: 'Members', icon: UsersIcon, active: pathname.startsWith(`${base}/members`) },
    { href: `${base}/invitations`, label: 'Invitations', icon: MailIcon, active: pathname.startsWith(`${base}/invitations`) },
  ]

  const menu = (
    <SideNav label="Workspace settings">
      {sections.map(({ href, label, icon, active }) => <SideNavItem key={href} href={href} active={active} icon={icon}>{label}</SideNavItem>)}
    </SideNav>
  )

  return (
    <SidebarLayout aside={menu} menuLabel={sections.find(section => section.active)?.label ?? 'Settings'}>
      <Routes>
        <Route index element={<WorkspaceSettingsGeneral />} />
        <Route path="members" element={<WorkspaceSettingsMembers admin />} />
        <Route path="invitations" element={<WorkspaceSettingsInvitations />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SidebarLayout>
  )
}
