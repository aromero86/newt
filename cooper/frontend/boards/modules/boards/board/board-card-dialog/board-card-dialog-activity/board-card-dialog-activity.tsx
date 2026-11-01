import { useEffect } from 'react'
import { HistoryIcon, RefreshCwIcon } from 'lucide-react'
import type { ActivityDTO } from '@cooper/api/activity'
import type { CardDTO } from '@cooper/api/card'
import { Alert } from 'newt-kit-react-ui/alert'
import { Badge } from 'newt-kit-react-ui/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta } from 'newt-kit-react-ui/box'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { RelativeTime } from 'newt-kit-react-ui/relative-time'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Text } from 'newt-kit-react-ui/text'
import { Provide, useService, useValue } from 'newt-kit-react'
import { WorkspaceService } from '../../../../workspace/workspace.service'
import { BoardService } from '../../board.service'
import { BoardCardDialogActivityService } from './board-card-dialog-activity.service'

/** What an entry says happened, with the names the board knows. */
function describe(entry: ActivityDTO, member: (id: string | null) => string, column: (id: string | null) => string): string {
  const { detail } = entry
  const text = (key: string) => (typeof detail[key] === 'string' ? detail[key] : null)
  switch (entry.kind) {
    case 'created': return `created it in ${column(text('columnId'))}`
    case 'edited': return `changed its ${text('changed') || 'text'}`
    case 'moved': return `moved it from ${column(text('fromColumnId'))} to ${column(text('toColumnId'))}`
    case 'assigned': return `assigned it to ${member(text('assigneeId'))}`
    case 'unassigned': return `took it from ${member(text('previousAssigneeId'))}`
    case 'deleted': return 'deleted it'
  }
}

/** A card's activity, the newest first. With its own BoardCardDialogActivityService. */
export function BoardCardDialogActivity({ card }: { card: CardDTO }) {
  return (
    <Provide services={[BoardCardDialogActivityService]}>
      <BoardCardDialogActivityWrapped card={card} />
    </Provide>
  )
}

function BoardCardDialogActivityWrapped({ card }: { card: CardDTO }) {
  const activity = useService(BoardCardDialogActivityService)
  const members = useValue(useService(WorkspaceService).byId)
  const columns = useValue(useService(BoardService).columns)
  const items = useValue(activity.list.items)
  const loaded = useValue(activity.list.loaded)
  const loading = useValue(activity.list.loading)
  const hasMore = useValue(activity.list.hasMore)
  const loadingMore = useValue(activity.list.loadingMore)
  const failure = useValue(activity.list.failure)

  useEffect(() => {
    activity.show(card)
  }, [activity, card])

  const member = (id: string | null) => (id === null ? 'nobody' : members.get(id)?.name ?? 'someone who left')
  const column = (id: string | null) => columns.find(each => each.id === id)?.name ?? 'a removed column'

  return (
    <Box label="Activity">
      <BoxHeader actions={(
        <Button variant="ghost" size="icon-sm" label="Refresh the activity" loading={loading} onClick={() => void activity.list.loadFirstPage()}>
          <Icon icon={RefreshCwIcon} />
        </Button>
      )}
      >
        Activity
      </BoxHeader>
      {failure && <BoxRow><Alert tone="bad" title="Could not load the activity">{failure}</Alert></BoxRow>}
      {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
      {loaded && items.length === 0 && <BoxEmpty icon={HistoryIcon} title="Nothing yet" description="What happens to the card shows here a moment later." />}
      {items.map(entry => (
        <BoxRow key={entry.id} trailing={entry.via === 'mcp' && <Badge tone="info">via MCP</Badge>}>
          <Text size="sm">{entry.actorId === null ? 'Cooper' : member(entry.actorId)} {describe(entry, member, column)}</Text>
          <BoxRowMeta><RelativeTime date={entry.at} /></BoxRowMeta>
        </BoxRow>
      ))}
      {hasMore && (
        <BoxFooter>
          <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void activity.list.loadMore()}>Load more</Button>
        </BoxFooter>
      )}
    </Box>
  )
}
