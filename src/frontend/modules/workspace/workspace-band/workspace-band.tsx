import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { BookOpenIcon, GitPullRequestIcon, LayersIcon, SettingsIcon, TagIcon } from 'lucide-react'
import type { WorkspaceMineDTO } from '@newt/api/workspace'
import { Badge } from '@newt/ui/components/badge'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Icon } from '@newt/ui/components/icon'
import { PageBand } from '@newt/ui/components/page-band'
import { UnderlineNav, UnderlineNavItem } from '@newt/ui/components/underline-nav'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspaceBandService } from './workspace-band.service'

/** With its own WorkspaceBandService: whoever renders it needs nothing else. */
export function WorkspaceBand({ workspace }: { workspace: WorkspaceMineDTO }) {
  return (
    <Provide services={[WorkspaceBandService]}>
      <WorkspaceBandWrapped workspace={workspace} />
    </Provide>
  )
}

/** The workspace's header, like a repository's on GitHub: its name and its parts, with their counts. */
function WorkspaceBandWrapped({ workspace }: { workspace: WorkspaceMineDTO }) {
  const service = useService(WorkspaceBandService)
  const openProposals = useValue(service.openProposals)
  const releases = useValue(service.releases)
  const { pathname } = useLocation()
  const base = `/w/${workspace.id}`
  const tab = (path: string) => ({ href: `${base}/${path}`, active: pathname.startsWith(`${base}/${path}`) })

  useEffect(() => {
    void service.load(workspace.id)
  }, [service, workspace.id, pathname])

  return (
    <PageBand
      title={(
        <>
          <Icon icon={LayersIcon} size="lg" tone="muted" />
          <Breadcrumbs items={[{ label: workspace.name }]} />
        </>
      )}
      meta={(
        <>
          {workspace.archivedAt && <Badge tone="warn">archived</Badge>}
          {workspace.myRole === 'admin' && <Badge tone="outline">admin</Badge>}
        </>
      )}
      nav={(
        <UnderlineNav label={`${workspace.name} sections`}>
          <UnderlineNavItem {...tab('definition')} icon={BookOpenIcon}>Definition</UnderlineNavItem>
          <UnderlineNavItem {...tab('proposals')} icon={GitPullRequestIcon} count={openProposals || undefined}>Proposals</UnderlineNavItem>
          <UnderlineNavItem {...tab('releases')} icon={TagIcon} count={releases || undefined}>Releases</UnderlineNavItem>
          <UnderlineNavItem {...tab('settings')} icon={SettingsIcon}>Settings</UnderlineNavItem>
        </UnderlineNav>
      )}
    />
  )
}
