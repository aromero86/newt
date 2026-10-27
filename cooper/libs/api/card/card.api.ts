import type { CardAssignDTO, CardCreateDTO, CardDTO, CardEditDTO, CardMoveDTO, CardSearchDTO } from '../../../backend/contexts/boards/modules/card/card.schema'
import type { Page } from 'newt/contract'
import { type PageRequest, Requester } from 'newt-react'

/** The backend's `card` module: the cards of a workspace's boards. */
export class CardApi extends Requester {
  protected readonly path = '/workspaces'

  /** A board's cards, column by column and from the top. */
  listInBoard(workspaceId: string, boardId: string) {
    return this.get<CardDTO[]>(`/${workspaceId}/boards/${boardId}/cards`)
  }

  getCard(workspaceId: string, cardId: string) {
    return this.get<CardDTO>(`/${workspaceId}/cards/${cardId}`)
  }

  /** A page of the workspace's cards with the text, that pass the filter. */
  search(workspaceId: string, input: CardSearchDTO, page?: PageRequest) {
    const query = new URLSearchParams()
    if (page?.size !== undefined) query.set('size', String(page.size))
    if (page?.cursor) query.set('cursor', page.cursor)
    return this.post<Page<CardDTO>>(`/${workspaceId}/cards/search${query.size ? `?${query}` : ''}`, input)
  }

  /**
   * A new card at the bottom of a column, with the board's next number. Each submit
   * has an `Idempotency-Key` of its own: the same request sent again with it (its
   * answer lost on the way) gets the card it made the first time, not a second one.
   */
  create(workspaceId: string, boardId: string, input: CardCreateDTO, idempotencyKey: string = crypto.randomUUID()) {
    return this.post<CardDTO>(`/${workspaceId}/boards/${boardId}/cards`, input, { 'idempotency-key': idempotencyKey })
  }

  edit(workspaceId: string, cardId: string, input: CardEditDTO) {
    return this.patch<CardDTO>(`/${workspaceId}/cards/${cardId}`, input)
  }

  /** To a column of its board, at a position (the bottom when none is given). */
  move(workspaceId: string, cardId: string, input: CardMoveDTO) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/move`, input)
  }

  /** To a member of the workspace: a 400 `card.assignee_not_member` for anyone else. */
  assign(workspaceId: string, cardId: string, input: CardAssignDTO) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/assign`, input)
  }

  unassign(workspaceId: string, cardId: string) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/unassign`)
  }

  remove(workspaceId: string, cardId: string) {
    return this.delete<void>(`/${workspaceId}/cards/${cardId}`)
  }
}
