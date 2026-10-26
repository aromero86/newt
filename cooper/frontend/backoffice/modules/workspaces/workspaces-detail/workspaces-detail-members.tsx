import { UsersIcon } from 'lucide-react'
import { Alert } from '@cooper/ui/components/alert'
import { Avatar } from '@cooper/ui/components/avatar'
import { Badge } from '@cooper/ui/components/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { Counter } from '@cooper/ui/components/counter'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { WorkspacesDetailService } from './workspaces-detail.service'

/** Who is in the workspace, its admin first. */
export function WorkspacesDetailMembers() {
  const { members } = useService(WorkspacesDetailService)
  const items = useValue(members.items)
  const total = useValue(members.total)
  const loaded = useValue(members.loaded)
  const hasMore = useValue(members.hasMore)
  const loadingMore = useValue(members.loadingMore)
  const failure = useValue(members.failure)

  return (
    <Box label="Members">
      <BoxHeader>Members {loaded && <Counter>{total}</Counter>}</BoxHeader>
      {failure && <Alert tone="bad" title="Could not load the members">{failure}</Alert>}
      {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
      {loaded && items.length === 0 && <BoxEmpty icon={UsersIcon} title="No members" />}
      {items.map(member => (
        <BoxRow key={member.id} leading={<Avatar name={member.name} size={8} />} trailing={<Badge tone={member.role === 'admin' ? 'brand' : 'muted'}>{member.role}</Badge>}>
          <BoxRowTitle href={`/users/${member.userId}`}>{member.name}</BoxRowTitle>
          <BoxRowMeta>
            <span>{member.email}</span>
            <span>·</span>
            <span>joined <RelativeTime date={member.since} /></span>
          </BoxRowMeta>
        </BoxRow>
      ))}
      {hasMore && (
        <BoxFooter>
          <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void members.loadMore()}>Load more</Button>
        </BoxFooter>
      )}
    </Box>
  )
}
