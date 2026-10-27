import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Breadcrumbs } from 'newt-react-ui/breadcrumbs'
import { Grid } from 'newt-react-ui/grid'
import { PageHeader } from 'newt-react-ui/page-header'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { TextLink } from 'newt-react-ui/link'
import { Provide, useService, useValue } from 'newt-react'
import { NotFound } from '../../../pages/not-found/not-found'
import { WorkspacesDetailBoards } from './workspaces-detail-boards'
import { WorkspacesDetailMembers } from './workspaces-detail-members'
import { WorkspacesDetailService } from './workspaces-detail.service'

/** One workspace's page: its admin, its numbers, its members and boards. With its own WorkspacesDetailService. */
export function WorkspacesDetail() {
  return (
    <Provide services={[WorkspacesDetailService]}>
      <WorkspacesDetailWrapped />
    </Provide>
  )
}

function WorkspacesDetailWrapped() {
  const workspaceId = useParams().workspaceId!
  const detail = useService(WorkspacesDetailService)
  const workspace = useValue(detail.workspace)
  const missing = useValue(detail.missing)
  const failure = useValue(detail.failure)

  useEffect(() => {
    void detail.load(workspaceId)
  }, [detail, workspaceId])

  if (missing) return <NotFound />

  return (
    <Stack gap={6}>
      <Breadcrumbs items={[{ label: 'Workspaces', href: '/workspaces' }, { label: workspace?.name ?? '…' }]} />
      {failure && <Alert tone="bad" title="Could not load the workspace">{failure}</Alert>}
      {!workspace && !failure && <Skeleton height="lg" />}
      {workspace && (
        <>
          <PageHeader
            title={workspace.name}
            description={(
              <>
                {workspace.admin
                  ? <>Admin <TextLink href={`/users/${workspace.admin.id}`}>{workspace.admin.name}</TextLink> ({workspace.admin.email})</>
                  : 'Its admin\'s account is gone'}
                {' · created '}<RelativeTime date={workspace.createdAt} />
              </>
            )}
          />
          <Grid columns={{ base: 1, sm: 3 }}>
            <Stat label="Members" value={workspace.members} />
            <Stat label="Boards" value={workspace.boards} />
            <Stat label="Cards" value={workspace.cards} />
          </Grid>
          <WorkspacesDetailMembers />
          <WorkspacesDetailBoards />
        </>
      )}
    </Stack>
  )
}
