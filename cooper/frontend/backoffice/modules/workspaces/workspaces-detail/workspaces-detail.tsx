import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@cooper/ui/components/alert'
import { Breadcrumbs } from '@cooper/ui/components/breadcrumbs'
import { Grid } from '@cooper/ui/components/grid'
import { PageHeader } from '@cooper/ui/components/page-header'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Stack } from '@cooper/ui/components/stack'
import { Stat } from '@cooper/ui/components/stat'
import { TextLink } from '@cooper/ui/components/link'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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
