import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { ActivityIcon, ArchiveIcon, PlusIcon } from 'lucide-react'
import { Alert } from '@newt-kit/react-ui/alert'
import { Badge } from '@newt-kit/react-ui/badge'
import { Box, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { PageBody } from '@newt-kit/react-ui/page-body'
import { PageHeader } from '@newt-kit/react-ui/page-header'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { Provide, useService, useValue } from '@newt-kit/react'
import { ConnectionBadge } from '../../components/connection-badge/connection-badge'
import { AppsRegister } from './apps-register'
import { AppsService, type AppsFilter } from './apps.service'

/** The applications the monitor watches, or those archived (`?status=archived`). With its own AppsService. */
export function Apps() {
  return (
    <Provide services={[AppsService]}>
      <AppsWrapped />
    </Provide>
  )
}

function AppsWrapped() {
  const apps = useService(AppsService)
  const [search, setSearch] = useSearchParams()
  const filter: AppsFilter = search.get('status') === 'archived' ? 'archived' : 'active'
  const counts = useValue(apps.counts)
  const connections = useValue(apps.connections)
  const items = useValue(apps.list.items)
  const loaded = useValue(apps.list.loaded)
  const loading = useValue(apps.list.loading)
  const hasMore = useValue(apps.list.hasMore)
  const loadingMore = useValue(apps.list.loadingMore)
  const failure = useValue(apps.list.failure)

  useEffect(() => {
    void apps.load(filter)
  }, [apps, filter])

  const show = (next: AppsFilter) => setSearch(next === 'active' ? {} : { status: next })

  return (
    <PageBody>
      <Stack gap={4}>
        <PageHeader
          title="Applications"
          description="The newt applications this monitor watches: what each one is made of, read from it as it runs."
          actions={<Button onClick={() => apps.openRegister()}><Icon icon={PlusIcon} size="sm" />New application</Button>}
        />
        {failure && <Alert tone="bad" title="Could not load the applications">{failure}</Alert>}
        <Box label="Applications">
          <BoxHeader>
            <Inline gap={2}>
              <BoxFilter active={filter === 'active'} icon={ActivityIcon} count={counts.active ?? undefined} onClick={() => show('active')}>Watched</BoxFilter>
              <BoxFilter active={filter === 'archived'} icon={ArchiveIcon} count={counts.archived ?? undefined} onClick={() => show('archived')}>Archived</BoxFilter>
            </Inline>
          </BoxHeader>
          {loading && !loaded && [0, 1].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
          {loaded && items.length === 0 && (filter === 'active'
            ? <BoxEmpty icon={ActivityIcon} title="No applications yet" description="Register one: where its monitor endpoint listens, and its key." action={<Button size="sm" variant="outline" onClick={() => apps.openRegister()}>New application</Button>} />
            : <BoxEmpty icon={ArchiveIcon} title="Nothing archived" description="An archived application is not watched, and keeps all that was known of it." />)}
          {items.map(app => (
            <BoxRow
              key={app.id}
              leading={<Icon icon={app.archivedAt ? ArchiveIcon : ActivityIcon} tone="muted" />}
              trailing={app.archivedAt ? <Badge tone="warn">Archived</Badge> : connections[app.id] && <ConnectionBadge status={connections[app.id]!} />}
            >
              <BoxRowTitle href={`/apps/${app.id}`}>{app.name}</BoxRowTitle>
              <BoxRowMeta>
                <>{app.url}</>
                {app.archivedAt ? <>archived <RelativeTime date={app.archivedAt} /></> : <>added <RelativeTime date={app.createdAt} /></>}
              </BoxRowMeta>
            </BoxRow>
          ))}
          {hasMore && (
            <BoxFooter>
              <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void apps.loadMore()}>Load more</Button>
            </BoxFooter>
          )}
        </Box>
        <AppsRegister />
      </Stack>
    </PageBody>
  )
}
