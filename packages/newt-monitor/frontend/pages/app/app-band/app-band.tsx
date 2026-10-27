import { useLocation } from 'react-router'
import { ActivityIcon, ArchiveIcon, BlocksIcon, BookOpenIcon, MegaphoneIcon, PlayIcon, RefreshCwIcon, ZapIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Breadcrumbs } from 'newt-react-ui/breadcrumbs'
import { Button } from 'newt-react-ui/button'
import { Icon } from 'newt-react-ui/icon'
import { PageBand } from 'newt-react-ui/page-band'
import { UnderlineNav, UnderlineNavItem } from 'newt-react-ui/underline-nav'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { ConnectionBadge } from '../../../components/connection-badge/connection-badge'
import { AppService } from '../app.service'

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
      meta={app.archivedAt ? <Badge tone="warn">Archived</Badge> : connection && <ConnectionBadge status={connection.status} />}
      actions={app.archivedAt ? undefined : (
        <>
          <Button size="sm" variant="outline" loading={checking} onClick={() => void service.check()}><Icon icon={ZapIcon} size="sm" />Check connection</Button>
          <Button size="sm" variant="outline" loading={refreshing} onClick={() => void service.refresh()}><Icon icon={RefreshCwIcon} size="sm" />Refresh structure</Button>
        </>
      )}
      nav={(
        <UnderlineNav label={`${app.name} sections`}>
          <UnderlineNavItem {...tab('')} icon={BookOpenIcon}>Overview</UnderlineNavItem>
          <UnderlineNavItem {...tab('contexts')} icon={BlocksIcon} count={count(counts.contexts)}>Contexts</UnderlineNavItem>
          <UnderlineNavItem {...tab('use-cases')} icon={PlayIcon} count={count(counts.useCases)}>Use cases</UnderlineNavItem>
          <UnderlineNavItem {...tab('events')} icon={MegaphoneIcon} count={count(counts.events)}>Events</UnderlineNavItem>
        </UnderlineNav>
      )}
    />
  )
}
