import { useEffect } from 'react'
import { useParams } from 'react-router'
import { LayersIcon } from 'lucide-react'
import { Alert } from '@cooper/ui/components/alert'
import { Badge } from '@cooper/ui/components/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Breadcrumbs } from '@cooper/ui/components/breadcrumbs'
import { Button } from '@cooper/ui/components/button'
import { Counter } from '@cooper/ui/components/counter'
import { Icon } from '@cooper/ui/components/icon'
import { Inline } from '@cooper/ui/components/inline'
import { PageHeader } from '@cooper/ui/components/page-header'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Stack } from '@cooper/ui/components/stack'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { UsersDetailService } from './users-detail.service'

/** One account's page: who it is, whether it is staff, and its workspaces. With its own UsersDetailService. */
export function UsersDetail() {
  return (
    <Provide services={[UsersDetailService]}>
      <UsersDetailWrapped />
    </Provide>
  )
}

function UsersDetailWrapped() {
  const userId = useParams().userId!
  const detail = useService(UsersDetailService)
  const user = useValue(detail.user)
  const missing = useValue(detail.missing)
  const failure = useValue(detail.failure)
  const items = useValue(detail.workspaces.items)
  const total = useValue(detail.workspaces.total)
  const loaded = useValue(detail.workspaces.loaded)
  const hasMore = useValue(detail.workspaces.hasMore)
  const loadingMore = useValue(detail.workspaces.loadingMore)

  useEffect(() => {
    void detail.load(userId)
  }, [detail, userId])

  if (missing) return <NotFound />

  return (
    <Stack gap={6}>
      <Breadcrumbs items={[{ label: 'Users', href: '/users' }, { label: user?.name ?? '…' }]} />
      {failure && <Alert tone="bad" title="Could not load the account">{failure}</Alert>}
      {!user && !failure && <Skeleton height="lg" />}
      {user && (
        <>
          <PageHeader
            title={<Inline gap={2}>{user.name}{user.staff && <Badge tone="brand">staff</Badge>}</Inline>}
            description={<>{user.email} · signed up <RelativeTime date={user.createdAt} /> · {user.staff ? 'staff, may use the backoffice' : 'not staff'}</>}
          />
          <Box label="Workspaces">
            <BoxHeader>Workspaces {loaded && <Counter>{total}</Counter>}</BoxHeader>
            {!loaded && <BoxRow><Skeleton lines={2} /></BoxRow>}
            {loaded && items.length === 0 && <BoxEmpty icon={LayersIcon} title="In no workspace" />}
            {items.map(workspace => (
              <BoxRow key={workspace.id} leading={<Icon icon={LayersIcon} tone="muted" />} trailing={<Badge tone={workspace.role === 'admin' ? 'brand' : 'muted'}>{workspace.role}</Badge>}>
                <BoxRowTitle href={`/workspaces/${workspace.workspaceId}`}>{workspace.name}</BoxRowTitle>
                <BoxRowMeta>joined <RelativeTime date={workspace.since} /></BoxRowMeta>
              </BoxRow>
            ))}
            {hasMore && (
              <BoxFooter>
                <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void detail.workspaces.loadMore()}>Load more</Button>
              </BoxFooter>
            )}
          </Box>
        </>
      )}
    </Stack>
  )
}
