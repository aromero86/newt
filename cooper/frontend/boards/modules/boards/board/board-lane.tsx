import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type { CardDTO } from '@cooper/api/card'
import type { ColumnDTO } from '@cooper/api/column'
import type { WorkspaceMemberDTO } from '@cooper/api/workspace-member'
import { BoardCard, BoardColumn } from '@cooper/ui/components/board'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { Menu, type MenuItem } from 'newt-kit-react-ui/menu'
import { useService } from 'newt-kit-react'
import { BoardService } from './board.service'

type BoardLaneProps = {
  column: ColumnDTO
  /** Its cards, from the top. */
  cards: CardDTO[]
  /** Every column of the board, from left to right: where its cards can go. */
  columns: ColumnDTO[]
  members: Map<string, WorkspaceMemberDTO>
  onRename: () => void
  onAddCard: () => void
  onOpenCard: (card: CardDTO) => void
}

/**
 * One column of the board, with its cards. Everything dragging does is in the menus
 * too, so the keyboard can do it: moving columns, and cards up, down and across.
 */
export function BoardLane({ column, cards, columns, members, onRename, onAddCard, onOpenCard }: BoardLaneProps) {
  const board = useService(BoardService)
  const place = columns.findIndex(each => each.id === column.id)

  const columnMenu: MenuItem[] = [
    { label: 'Rename', icon: PencilIcon, onSelect: onRename },
    { label: 'Move left', icon: ArrowLeftIcon, disabled: place === 0, onSelect: () => void board.moveColumn(column, place - 1) },
    { label: 'Move right', icon: ArrowRightIcon, disabled: place === columns.length - 1, onSelect: () => void board.moveColumn(column, place + 1) },
    { separator: true },
    columns.length === 1
      ? { label: 'Remove (a board keeps one column)', icon: Trash2Icon, disabled: true, onSelect: () => {} }
      : cards.length > 0
        ? { label: 'Remove (move its cards out first)', icon: Trash2Icon, disabled: true, onSelect: () => {} }
        : { label: 'Remove', icon: Trash2Icon, tone: 'destructive', onSelect: () => void board.removeColumn(column) },
  ]

  function cardMenu(card: CardDTO, index: number): MenuItem[] {
    const others = columns.filter(each => each.id !== column.id)
    return [
      { label: 'Open', onSelect: () => onOpenCard(card) },
      { label: 'Move up', icon: ArrowUpIcon, disabled: index === 0, onSelect: () => void board.moveCard(card, column.id, index - 1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: index === cards.length - 1, onSelect: () => void board.moveCard(card, column.id, index + 1) },
      ...(others.length > 0 ? [{ separator: true } as const] : []),
      ...others.map(other => ({ label: `Move to ${other.name}`, icon: ArrowRightIcon, onSelect: () => void board.moveCard(card, other.id) })),
    ]
  }

  function onDropCard(cardId: string) {
    const card = board.cardsById.peek().get(cardId)
    if (card && card.columnId !== column.id) void board.moveCard(card, column.id)
  }

  return (
    <BoardColumn
      title={column.name}
      count={cards.length}
      actions={(
        <Menu
          label={`Actions for column ${column.name}`}
          trigger={<Button variant="ghost" size="icon-sm" label={`Actions for column ${column.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
          items={columnMenu}
        />
      )}
      footer={<Button variant="ghost" size="sm" block onClick={onAddCard}><Icon icon={PlusIcon} size="sm" />Add a card</Button>}
      onDropCard={onDropCard}
    >
      {cards.map((card, index) => (
        <BoardCard
          key={card.id}
          title={card.title}
          reference={`#${card.number}`}
          assignee={card.assigneeId ? (members.get(card.assigneeId)?.name ?? 'Someone who left') : undefined}
          onOpen={() => onOpenCard(card)}
          dragId={card.id}
          actions={(
            <Menu
              label={`Actions for #${card.number}`}
              trigger={<Button variant="ghost" size="icon-sm" label={`Actions for #${card.number}`}><Icon icon={MoreHorizontalIcon} size="sm" /></Button>}
              items={cardMenu(card, index)}
            />
          )}
        />
      ))}
    </BoardColumn>
  )
}
