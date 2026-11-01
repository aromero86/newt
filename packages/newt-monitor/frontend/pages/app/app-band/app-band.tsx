import { useLocation } from 'react-router'
import { ActivityIcon, ArchiveIcon, BlocksIcon, BookOpenIcon, GaugeIcon, ListOrderedIcon, RefreshCwIcon, SettingsIcon, WaypointsIcon, ZapIcon } from 'lucide-react'
import { Badge } from 'newt-kit-react-ui/badge'
import { Breadcrumbs } from 'newt-kit-react-ui/breadcrumbs'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { PageBand } from 'newt-kit-react-ui/page-band'
import { UnderlineNav, UnderlineNavItem } from 'newt-kit-react-ui/underline-nav'
import { useService, useValue } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { ConnectionBadge } from '../../../components/connection-badge/connection-badge'
import { AppService } from '../app.service'
import { DeployedCommit } from './deployed-commit'

/** The application's header, like a repository's on GitHub: its name, whether it answers, and its parts. */
export function AppBand({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const connection = useValue(service.connection)
  const checking = useValue(service.checking)
  const refreshing = useValue(service.refreshing)
  const counts = useValue(service.counts)
  const structure = useValue(service.structure)
  const count = (value: number) => (structure ? value : undefined)
  const { pathname } = useLocation()
  const base = `/apps/${app.id}`
  const tab = (path: string) => path === ''
    ? { href: base, active: pathname === base || pathname === `${base}/` }
    : { href: `${base}/${path}`, active: pathname.startsWith(`${base}/${path}`) }

  return (
    <PageBand
      title={(
        <>
          <Icon icon={app.archivedAt ? ArchiveIcon : ActivityIcon} size="lg" tone="muted" />
          <Breadcrumbs items={[{ label: 'Applications', href: '/' }, { label: app.name, href: base }]} />
        </>
      )}
      meta={app.archivedAt ? <Badge tone="warn">Archived</Badge> : <>{connection && <ConnectionBadge status={connection.status} />}<DeployedCommit app={app} /></>}
      actions={app.archivedAt ? undefined : (
        <>
          <Button size="sm" variant="outline" loading={checking} onClick={() => void service.check()}><Icon icon={ZapIcon} size="sm" />Check connection</Button>
          <Button size="sm" variant="outline" loading={refreshing} onClick={() => void service.refresh()}><Icon icon={RefreshCwIcon} size="sm" />Refresh structure</Button>
        </>
      )}
      nav={(
        <UnderlineNav label={`${app.name} sections`}>
          <UnderlineNavItem {...tab('')} icon={BookOpenIcon}>Overview</UnderlineNavItem>
          {/* A use case's and an event's pages are reached from their module's: they are part of Contexts. */}
          <UnderlineNavItem href={`${base}/contexts`} active={['contexts', 'use-cases', 'events'].some(path => pathname.startsWith(`${base}/${path}`))} icon={BlocksIcon} count={count(counts.contexts)}>Contexts</UnderlineNavItem>
          <UnderlineNavItem {...tab('queues')} icon={ListOrderedIcon}>Queues</UnderlineNavItem>
          <UnderlineNavItem {...tab('system')} icon={GaugeIcon}>System</UnderlineNavItem>
          <UnderlineNavItem {...tab('traces')} icon={WaypointsIcon}>Traces</UnderlineNavItem>
          <UnderlineNavItem {...tab('settings')} icon={SettingsIcon}>Settings</UnderlineNavItem>
        </UnderlineNav>
      )}
    />
  )
}
