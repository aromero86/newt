import type { ColumnAddDTO, ColumnDTO, ColumnMoveDTO, ColumnRenameDTO } from '../../../backend/contexts/boards/modules/column/column.schema'
import { Requester } from '../core/requester'

/** The backend's `column` module: a board's columns, at most `MAX_COLUMNS`. */
export class ColumnApi extends Requester {
  protected readonly path = '/workspaces'

  /** A board's columns, from left to right. */
  list(workspaceId: string, boardId: string) {
    return this.get<ColumnDTO[]>(`/${workspaceId}/boards/${boardId}/columns`)
  }

  /** A new column at the end of the board: a 409 `column.too_many` when it has ten. */
  add(workspaceId: string, boardId: string, input: ColumnAddDTO) {
    return this.post<ColumnDTO>(`/${workspaceId}/boards/${boardId}/columns`, input)
  }

  rename(workspaceId: string, columnId: string, input: ColumnRenameDTO) {
    return this.patch<ColumnDTO>(`/${workspaceId}/columns/${columnId}`, input)
  }

  /** To another place on its board; the others take the places left. */
  move(workspaceId: string, columnId: string, input: ColumnMoveDTO) {
    return this.post<ColumnDTO>(`/${workspaceId}/columns/${columnId}/move`, input)
  }

  /** Only an empty one, and not the board's last: a 409 `card.column_not_empty` or `column.last` otherwise. */
  remove(workspaceId: string, columnId: string) {
    return this.delete<void>(`/${workspaceId}/columns/${columnId}`)
  }
}
