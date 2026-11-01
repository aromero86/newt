import { useEffect } from 'react'
import { LayersIcon, PlusIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Badge } from 'newt-kit-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-kit-react-ui/box'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { PageBody } from 'newt-kit-react-ui/page-body'
import { PageHeader } from 'newt-kit-react-ui/page-header'
import { RelativeTime } from 'newt-kit-react-ui/relative-time'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Stack } from 'newt-kit-react-ui/stack'
import { useService, useValue } from 'newt-kit-react'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Where the app opens: every workspace the signed-in person is in, like a list of repositories. */
export function Home() {
  const workspaces = useService(WorkspacesService)
  const items = useValue(workspaces.items)
  const loaded = useValue(workspaces.loaded)
  const failure = useValue(workspaces.failure)

  useEffect(() => {
    void workspaces.load()
  }, [workspaces])

  const create = <Button size="sm" href="/workspaces/new"><Icon icon={PlusIcon} size="sm" />New workspace</Button>

  return (
    <PageBody width="medium">
      <Stack gap={6}>
        <PageHeader title="Your workspaces" description="One per team. Only their members see their boards." actions={create} />
        {failure && <Alert tone="bad" title="Could not load your workspaces">{failure}</Alert>}
        <Box label="Your workspaces">
          <BoxHeader>{loaded ? `${items.length} ${items.length === 1 ? 'workspace' : 'workspaces'}` : 'Workspaces'}</BoxHeader>
          {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
          {loaded && items.length === 0 && (
            <BoxEmpty icon={LayersIcon} title="No workspaces yet" description="Create one for your team, then invite the people you work with." action={create} />
          )}
          {items.map(workspace => (
            <BoxRow
              key={workspace.id}
              leading={<Icon icon={LayersIcon} tone="muted" />}
              trailing={<Badge tone={workspace.isAdmin ? 'brand' : 'muted'}>{workspace.isAdmin ? 'admin' : 'member'}</Badge>}
            >
              <BoxRowTitle href={`/w/${workspace.id}`}>{workspace.name}</BoxRowTitle>
              <BoxRowMeta>{'Created '}<RelativeTime date={workspace.createdAt} /></BoxRowMeta>
            </BoxRow>
          ))}
        </Box>
      </Stack>
    </PageBody>
  )
}
