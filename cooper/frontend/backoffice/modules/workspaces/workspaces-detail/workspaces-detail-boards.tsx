import { SquareKanbanIcon } from 'lucide-react'
import { Alert } from '@cooper/ui/components/alert'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { Counter } from '@cooper/ui/components/counter'
import { Icon } from '@cooper/ui/components/icon'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { WorkspacesDetailService } from './workspaces-detail.service'

/** The workspace's boards, the newest first, each with how many cards it has. */
export function WorkspacesDetailBoards() {
  const { boards } = useService(WorkspacesDetailService)
  const items = useValue(boards.items)
  const total = useValue(boards.total)
  const loaded = useValue(boards.loaded)
  const hasMore = useValue(boards.hasMore)
  const loadingMore = useValue(boards.loadingMore)
  const failure = useValue(boards.failure)

  return (
    <Box label="Boards">
      <BoxHeader>Boards {loaded && <Counter>{total}</Counter>}</BoxHeader>
      {failure && <Alert tone="bad" title="Could not load the boards">{failure}</Alert>}
      {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
      {loaded && items.length === 0 && <BoxEmpty icon={SquareKanbanIcon} title="No boards" />}
      {items.map(board => (
        <BoxRow key={board.id} leading={<Icon icon={SquareKanbanIcon} tone="muted" />} trailing={<>{board.cards} {board.cards === 1 ? 'card' : 'cards'}</>}>
          <BoxRowTitle>{board.name}</BoxRowTitle>
          <BoxRowMeta>
            {board.description && <><span>{board.description}</span><span>·</span></>}
            <span>created <RelativeTime date={board.createdAt} /></span>
          </BoxRowMeta>
        </BoxRow>
      ))}
      {hasMore && (
        <BoxFooter>
          <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void boards.loadMore()}>Load more</Button>
        </BoxFooter>
      )}
    </Box>
  )
}
