import { useLocation } from 'react-router'
import { KanbanIcon, LayersIcon, SearchIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import type { WorkspaceDTO } from '@cooper/api/workspace'
import { Badge } from '@cooper/ui/components/badge'
import { Breadcrumbs } from '@cooper/ui/components/breadcrumbs'
import { Icon } from '@cooper/ui/components/icon'
import { PageBand } from '@cooper/ui/components/page-band'
import { UnderlineNav, UnderlineNavItem } from '@cooper/ui/components/underline-nav'

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
