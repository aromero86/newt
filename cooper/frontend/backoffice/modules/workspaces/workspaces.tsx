import { useEffect } from 'react'
import { LayersIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { PageHeader } from 'newt-react-ui/page-header'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { SearchField } from 'newt-react-ui/search-field'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Provide, useService, useValue } from 'newt-react'
import { WorkspacesService } from './workspaces.service'

/** Every workspace of cooper, with a search by name. With its own WorkspacesService. */
export function Workspaces() {
  return (
    <Provide services={[WorkspacesService]}>
      <WorkspacesWrapped />
    </Provide>
  )
}

function WorkspacesWrapped() {
  const workspaces = useService(WorkspacesService)
  const name = useValue(workspaces.name)
  const items = useValue(workspaces.list.items)
  const total = useValue(workspaces.list.total)
  const loaded = useValue(workspaces.list.loaded)
  const loading = useValue(workspaces.list.loading)
  const hasMore = useValue(workspaces.list.hasMore)
  const loadingMore = useValue(workspaces.list.loadingMore)
  const failure = useValue(workspaces.list.failure)

  useEffect(() => {
    void workspaces.load()
  }, [workspaces])

  return (
    <Stack gap={4}>
      <PageHeader title="Workspaces" description="Every workspace of Cooper, the newest first." />
      <SearchField label="Search workspaces" placeholder="A workspace's whole name" defaultValue={name} onSearch={query => void workspaces.search(query)} />
      {failure && <Alert tone="bad" title="Could not load the workspaces">{failure}</Alert>}
      <Box label="Workspaces">
        <BoxHeader actions={name ? <Button size="sm" variant="ghost" onClick={() => void workspaces.search('')}>Clear search</Button> : undefined}>
          {name ? `Named “${name}”` : 'All workspaces'} {loaded && <Counter>{total}</Counter>}
        </BoxHeader>
        {loading && !loaded && [0, 1, 2].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && items.length === 0 && <BoxEmpty icon={LayersIcon} title="No workspaces" description={name ? 'No workspace has that name. Names are matched whole.' : undefined} />}
        {items.map(workspace => (
          <BoxRow key={workspace.id} leading={<Icon icon={LayersIcon} tone="muted" />} trailing={<>{workspace.cards} cards</>}>
            <BoxRowTitle href={`/workspaces/${workspace.id}`}>{workspace.name}</BoxRowTitle>
            <BoxRowMeta>
              <>{workspace.admin ? `${workspace.admin.name} (${workspace.admin.email})` : 'No admin'}</>
              <>created <RelativeTime date={workspace.createdAt} /></>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && (
          <BoxFooter>
            <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void workspaces.list.loadMore()}>Load more</Button>
          </BoxFooter>
        )}
      </Box>
    </Stack>
  )
}
