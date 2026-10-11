import { useEffect } from 'react'
import { LayersIcon, PlusIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { PageBody } from '@newt/ui/components/page-body'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Every workspace the signed-in person is in, like a list of repositories. */
export function Workspaces() {
  const { list } = useService(WorkspacesService)
  const items = useValue(list.items)
  const total = useValue(list.total)
  const loaded = useValue(list.loaded)
  const hasMore = useValue(list.hasMore)
  const loadingMore = useValue(list.loadingMore)
  const failure = useValue(list.failure)

  useEffect(() => {
    void list.loadFirstPage()
  }, [list])

  const create = <Button size="sm" href="/workspaces/new"><Icon icon={PlusIcon} size="sm" />New workspace</Button>

  return (
    <PageBody width="medium">
      <Stack gap={4}>
        <Subhead title="Your workspaces" description="One per product. Only their members see them." actions={create} />
        {failure && <Alert tone="bad" title="Could not load your workspaces">{failure}</Alert>}
        <Box label="Your workspaces">
          <BoxHeader>{`${total} ${total === 1 ? 'workspace' : 'workspaces'}`}</BoxHeader>
          {loaded && items.length === 0 && (
            <BoxEmpty icon={LayersIcon} title="No workspaces yet" description="Create one for your product, then bring in your team." action={create} />
          )}
          {items.map(workspace => (
            <BoxRow
              key={workspace.id}
              leading={<Icon icon={LayersIcon} tone="muted" />}
              trailing={(
                <Inline gap={2}>
                  {workspace.archivedAt && <Badge tone="warn">archived</Badge>}
                  <Badge tone={workspace.myRole === 'admin' ? 'brand' : 'muted'}>{workspace.myRole}</Badge>
                </Inline>
              )}
            >
              <BoxRowTitle href={`/w/${workspace.id}`}>{workspace.name}</BoxRowTitle>
              {workspace.description && <BoxRowMeta>{workspace.description}</BoxRowMeta>}
            </BoxRow>
          ))}
          {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void list.loadMore()}>Load more</Button></BoxFooter>}
        </Box>
      </Stack>
    </PageBody>
  )
}
