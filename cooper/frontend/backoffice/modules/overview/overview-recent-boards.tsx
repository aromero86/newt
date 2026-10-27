import { SquareKanbanIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Icon } from 'newt-react-ui/icon'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { useService, useValue } from 'newt-react'
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
            <>{board.workspaceName ?? 'a deleted workspace'}</>
            <>created <RelativeTime date={board.createdAt} /></>
          </BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}
