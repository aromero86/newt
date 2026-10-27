import { useLocation } from 'react-router'
import { KanbanIcon, LayersIcon, SearchIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import type { WorkspaceDTO } from '@cooper/api/workspace'
import { Badge } from 'newt-react-ui/badge'
import { Breadcrumbs } from 'newt-react-ui/breadcrumbs'
import { Icon } from 'newt-react-ui/icon'
import { PageBand } from 'newt-react-ui/page-band'
import { UnderlineNav, UnderlineNavItem } from 'newt-react-ui/underline-nav'

/** The workspace's header, like a repository's on GitHub: its name and its parts. */
export function WorkspaceBand({ workspace }: { workspace: WorkspaceDTO }) {
  const { pathname } = useLocation()
  const base = `/w/${workspace.id}`
  const tab = (path: string) => ({ href: `${base}/${path}`, active: pathname.startsWith(`${base}/${path}`) })

  return (
    <PageBand
      title={(
        <>
          <Icon icon={LayersIcon} size="lg" tone="muted" />
          <Breadcrumbs items={[{ label: workspace.name, href: `${base}/boards` }]} />
        </>
      )}
      meta={workspace.isAdmin ? <Badge tone="outline">admin</Badge> : undefined}
      nav={(
        <UnderlineNav label={`${workspace.name} sections`}>
          <UnderlineNavItem {...tab('boards')} icon={KanbanIcon}>Boards</UnderlineNavItem>
          <UnderlineNavItem {...tab('search')} icon={SearchIcon}>Search cards</UnderlineNavItem>
          {/* Its admin manages it; everyone else only sees who is in it, and may leave. */}
          {workspace.isAdmin
            ? <UnderlineNavItem {...tab('settings')} icon={SettingsIcon}>Settings</UnderlineNavItem>
            : <UnderlineNavItem {...tab('settings/members')} icon={UsersIcon}>Members</UnderlineNavItem>}
        </UnderlineNav>
      )}
    />
  )
}
