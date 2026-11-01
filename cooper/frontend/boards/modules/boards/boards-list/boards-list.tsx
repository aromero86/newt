import { useEffect } from 'react'
import { useParams } from 'react-router'
import { ArchiveIcon, KanbanIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import { Alert } from '@newt-kit/react-ui/alert'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'
import { ConfirmDialog } from '@newt-kit/react-ui/confirm-dialog'
import { Icon } from '@newt-kit/react-ui/icon'
import { Menu } from '@newt-kit/react-ui/menu'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { Subhead } from '@newt-kit/react-ui/subhead'
import { Provide, useService, useValue } from '@newt-kit/react'
import { BoardsListNew } from './boards-list-new'
import { BoardsListService } from './boards-list.service'

/** With its own BoardsListService: whoever renders it needs nothing else. */
export function BoardsList() {
  return (
    <Provide services={[BoardsListService]}>
      <BoardsListWrapped />
    </Provide>
  )
}

/** The workspace's boards, the newest first, like a list of repositories. */
function BoardsListWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(BoardsListService)
  const items = useValue(service.list.items)
  const total = useValue(service.list.total)
  const loaded = useValue(service.list.loaded)
  const loading = useValue(service.list.loading)
  const hasMore = useValue(service.list.hasMore)
  const loadingMore = useValue(service.list.loadingMore)
  const failure = useValue(service.list.failure)
  const archiving = useValue(service.archiving)
  const archivingBusy = useValue(service.archivingBusy)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  const create = <Button size="sm" onClick={() => service.startCreate()}><Icon icon={PlusIcon} size="sm" />New board</Button>

  return (
    <Stack gap={4}>
      <Subhead title="Boards" description="Each board has its columns, and cards that move through them." actions={create} />
      {failure && <Alert tone="bad" title="Could not load the boards">{failure}</Alert>}
      <Box label="Boards">
        <BoxHeader>{loaded ? `${total} ${total === 1 ? 'board' : 'boards'}` : 'Boards'}</BoxHeader>
        {!loaded && loading && [0, 1, 2].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && items.length === 0 && (
          <BoxEmpty icon={KanbanIcon} title="No boards yet" description="Create a board for a project or a team, and add its columns and cards." action={create} />
        )}
        {items.map(board => (
          <BoxRow
            key={board.id}
            leading={<Icon icon={KanbanIcon} tone="muted" />}
            trailing={(
              <Menu
                label={`Actions for ${board.name}`}
                trigger={<Button variant="ghost" size="icon-sm" label={`Actions for ${board.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                items={[{ label: 'Archive', icon: ArchiveIcon, tone: 'destructive', onSelect: () => service.askArchive(board) }]}
              />
            )}
          >
            <BoxRowTitle href={`/w/${workspaceId}/boards/${board.id}`}>{board.name}</BoxRowTitle>
            <BoxRowMeta>
              {board.description && <>{board.description}</>}
              <>{'Created '}<RelativeTime date={board.createdAt} /></>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.list.loadMore()}>Load more</Button></BoxFooter>}
      </Box>
      <BoardsListNew />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={open => !open && service.cancelArchive()}
        title={`Archive ${archiving?.name ?? 'the board'}?`}
        description="It leaves the list of boards, with its columns and cards."
        confirmLabel="Archive board"
        tone="destructive"
        loading={archivingBusy}
        onConfirm={() => void service.archive()}
      />
    </Stack>
  )
}
