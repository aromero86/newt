import { useEffect } from 'react'
import { useParams } from 'react-router'
import { LayersIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Badge } from 'newt-kit-react-ui/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-kit-react-ui/box'
import { Breadcrumbs } from 'newt-kit-react-ui/breadcrumbs'
import { Button } from 'newt-kit-react-ui/button'
import { Counter } from 'newt-kit-react-ui/counter'
import { Icon } from 'newt-kit-react-ui/icon'
import { Inline } from 'newt-kit-react-ui/inline'
import { PageHeader } from 'newt-kit-react-ui/page-header'
import { RelativeTime } from 'newt-kit-react-ui/relative-time'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Stack } from 'newt-kit-react-ui/stack'
import { Provide, useService, useValue } from 'newt-kit-react'
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
  const workspacesFailure = useValue(detail.workspaces.failure)

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
            {workspacesFailure && <Alert tone="bad" title="Could not load the workspaces">{workspacesFailure}</Alert>}
            {!loaded && !workspacesFailure && <BoxRow><Skeleton lines={2} /></BoxRow>}
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
