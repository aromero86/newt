import { SquareKanbanIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Icon } from '@cooper/ui/components/icon'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { OverviewService } from './overview.service'

/** The boards created last, whatever their workspace, each linked to its workspace's page. */
export function OverviewRecentBoards() {
  const boards = useValue(useService(OverviewService).recentBoards)
  if (!boards) return null

  return (
    <Box label="Recent boards">
      <BoxHeader>Recent boards</BoxHeader>
      {boards.length === 0 && <BoxEmpty icon={SquareKanbanIcon} title="No boards yet" />}
      {boards.map(board => (
        <BoxRow key={board.id} leading={<Icon icon={SquareKanbanIcon} tone="muted" />}>
          <BoxRowTitle href={board.workspaceName === null ? undefined : `/workspaces/${board.workspaceId}`}>{board.name}</BoxRowTitle>
          <BoxRowMeta>
            <span>{board.workspaceName ?? 'a deleted workspace'}</span>
            <span>·</span>
            <span>created <RelativeTime date={board.createdAt} /></span>
          </BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}
