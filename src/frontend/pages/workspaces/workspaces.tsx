import { useEffect } from 'react'
import { LayersIcon, PlusIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { EmptyState } from '@newt/ui/components/empty-state'
import { Grid } from '@newt/ui/components/grid'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Every workspace the signed-in person is in. */
export function Workspaces() {
  const { list } = useService(WorkspacesService)
  const items = useValue(list.items)
  const loaded = useValue(list.loaded)
  const hasMore = useValue(list.hasMore)
  const loadingMore = useValue(list.loadingMore)
  const failure = useValue(list.failure)

  useEffect(() => {
    void list.loadFirstPage()
  }, [list])

  const create = (
    <Button href="/workspaces/new">
      <Icon icon={PlusIcon} />
      New workspace
    </Button>
  )

  return (
    <Stack gap={8}>
      <PageHeader title="Workspaces" description="One per product. Only their members see them." actions={items.length > 0 ? create : undefined} />
      {failure && <Alert tone="bad" title="Could not load your workspaces">{failure}</Alert>}
      {!loaded && !failure && <Spinner label="Loading your workspaces" />}
      {loaded && items.length === 0 && (
        <EmptyState icon={LayersIcon} title="No workspaces yet" description="Create one for your product, then bring in your team." action={create} />
      )}
      {items.length > 0 && (
        <Grid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
          {items.map(workspace => (
            <Card
              key={workspace.id}
              title={workspace.name}
              description={workspace.description || undefined}
              footer={<TextLink href={`/w/${workspace.id}`}>Open {workspace.name}</TextLink>}
            >
              <Inline gap={2}>
                <Badge tone={workspace.myRole === 'admin' ? 'brand' : 'muted'}>{workspace.myRole}</Badge>
                {workspace.archivedAt && <Badge tone="warn">archived</Badge>}
              </Inline>
            </Card>
          ))}
        </Grid>
      )}
      {hasMore && (
        <Button variant="outline" loading={loadingMore} onClick={() => void list.loadMore()}>
          Load more
        </Button>
      )}
    </Stack>
  )
}
