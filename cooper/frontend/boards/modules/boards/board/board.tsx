import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { ColumnsIcon, PlusIcon } from 'lucide-react'
import type { CardDTO } from '@cooper/api/card'
import { MAX_COLUMNS, type ColumnDTO } from '@cooper/api/column'
import { Alert } from 'newt-kit-react-ui/alert'
import { Board as BoardFrame, BoardSkeleton } from '@cooper/ui/components/board'
import { Button } from 'newt-kit-react-ui/button'
import { EmptyState } from 'newt-kit-react-ui/empty-state'
import { Icon } from 'newt-kit-react-ui/icon'
import { PageHeader } from 'newt-kit-react-ui/page-header'
import { Spinner } from 'newt-kit-react-ui/spinner'
import { Stack } from 'newt-kit-react-ui/stack'
import { Provide, useService, useValue } from 'newt-kit-react'
import { NotFound } from '../../../pages/not-found/not-found'
import { WorkspaceService } from '../../workspace/workspace.service'
import { BoardCardDialog } from './board-card-dialog/board-card-dialog'
import { BoardCardNew } from './board-card-new/board-card-new'
import { BoardColumnForm } from './board-column-form/board-column-form'
import { BoardLane } from './board-lane'
import { BoardService } from './board.service'

/** With its own BoardService: whoever renders it needs nothing else. */
export function Board() {
  return (
    <Provide services={[BoardService]}>
      <BoardWrapped />
    </Provide>
  )
}

/**
 * A board: its columns side by side, with their cards. The card being looked at is
 * in the address (`?card=<id>`), so a link from the search opens it.
 */
function BoardWrapped() {
  const { workspaceId, boardId } = useParams() as { workspaceId: string, boardId: string }
  const service = useService(BoardService)
  const board = useValue(service.board)
  const columns = useValue(service.columns)
  const lanes = useValue(service.cardsByColumn)
  const cardsById = useValue(service.cardsById)
  const loading = useValue(service.loading)
  const notFound = useValue(service.notFound)
  const failure = useValue(service.failure)
  const members = useValue(useService(WorkspaceService).byId)
  const [params, setParams] = useSearchParams()
  // Which dialog is open: purely what this screen shows.
  const [naming, setNaming] = useState<{ column: ColumnDTO | null } | null>(null)
  const [addingTo, setAddingTo] = useState<ColumnDTO | null>(null)

  useEffect(() => {
    void service.load(workspaceId, boardId)
  }, [service, workspaceId, boardId])

  const openCard = params.get('card')
  const opened = openCard ? cardsById.get(openCard) : undefined

  function setOpenCard(card: CardDTO | null) {
    setParams(current => {
      const next = new URLSearchParams(current)
      if (card) next.set('card', card.id)
      else next.delete('card')
      return next
    })
  }

  if (notFound) return <NotFound />
  if (!board) {
    return (
      <Stack gap={6}>
        {failure ? <Alert tone="bad" title="Could not load the board">{failure}</Alert> : <Spinner size="sm" label="Loading the board" />}
        {loading && <BoardSkeleton />}
      </Stack>
    )
  }

  const full = columns.length >= MAX_COLUMNS
  const addColumn = (
    <Button size="sm" variant="outline" disabled={full} onClick={() => setNaming({ column: null })}>
      <Icon icon={PlusIcon} size="sm" />
      {full ? `${MAX_COLUMNS} columns, the most` : 'Add column'}
    </Button>
  )

  return (
    <Stack gap={6}>
      <PageHeader title={board.name} description={board.description || undefined} actions={addColumn} />
      {failure && <Alert tone="bad" title="The board may be out of date">{failure}</Alert>}
      {columns.length === 0
        ? (
            <EmptyState
              icon={ColumnsIcon}
              title="No columns yet"
              description="Columns are the steps cards move through: To do, Doing, Done…"
              action={<Button onClick={() => setNaming({ column: null })}><Icon icon={PlusIcon} size="sm" />Add the first column</Button>}
            />
          )
        : (
            <BoardFrame label={board.name}>
              {columns.map(column => (
                <BoardLane
                  key={column.id}
                  column={column}
                  cards={lanes.get(column.id) ?? []}
                  columns={columns}
                  members={members}
                  onRename={() => setNaming({ column })}
                  onAddCard={() => setAddingTo(column)}
                  onOpenCard={setOpenCard}
                />
              ))}
            </BoardFrame>
          )}
      {naming && <BoardColumnForm column={naming.column} onClose={() => setNaming(null)} />}
      {addingTo && <BoardCardNew column={addingTo} onClose={() => setAddingTo(null)} />}
      {opened && <BoardCardDialog card={opened} onClose={() => setOpenCard(null)} />}
    </Stack>
  )
}
