import { Entity, type EntityInput } from 'newt/core'
import { CardSchema, type CardDTO } from './card.schema'
import { Card_Assigned } from './events/card-assigned'
import { Card_Created } from './events/card-created'
import { Card_Deleted } from './events/card-deleted'
import { Card_Edited } from './events/card-edited'
import { Card_Moved } from './events/card-moved'
import { Card_Unassigned } from './events/card-unassigned'

export * from './card.schema'

/**
 * What it takes to create a card: checked, in its workspace, with the number and the
 * place it looked to get. Its save gives it the ones it really gets.
 */
export type CardOpening = {
  workspaceId: string
  boardId: string
  columnId: string
  number: number
  position: number
  title: string
  description: string
  assigneeId: string | null
}

/** A card of a board. */
export class Card extends Entity<typeof CardSchema> {

  private constructor(input: EntityInput<CardDTO>, isNew: boolean) {
    super(CardSchema, input, isNew)
  }

  static fromDTO(dto: CardDTO & { version: number }): Card {
    return new Card(dto, false)
  }

  static create(input: CardOpening): Card {
    const card = new Card(input, true)
    card.trackEvent(new Card_Created(card.toDTO()))
    return card
  }

  get boardId(): string {
    return this.data.boardId
  }

  get columnId(): string {
    return this.data.columnId
  }

  get position(): number {
    return this.data.position
  }

  get assigneeId(): string | null {
    return this.data.assigneeId
  }

  /**
   * A new one takes its number and its place as it is saved: the next number of its
   * board and the bottom of its column, read where no other card can take them in
   * between. What it tells says them.
   */
  place(number: number, position: number): void {
    if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
    this.change({ number, position })
    this.trackEvent(new Card_Created(this.toDTO()))
  }

  edit(changes: { title?: string, description?: string }): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Card_Edited({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Someone moved it: to this column, at this position. */
  moveTo(columnId: string, position: number): void {
    this.change({ columnId, position })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Card_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

  /** To a member of its workspace: the module checked they are. Assigning it again to the same one changes nothing. */
  assign(assigneeId: string): void {
    const previousAssigneeId = this.data.assigneeId
    if (assigneeId === previousAssigneeId) return
    this.change({ assigneeId })
    this.trackEvent(new Card_Assigned({ dto: this.toDTO(), previousAssigneeId }))
  }

  unassign(): void {
    const previousAssigneeId = this.data.assigneeId
    if (previousAssigneeId === null) return
    this.change({ assigneeId: null })
    this.trackEvent(new Card_Unassigned({ dto: this.toDTO(), previousAssigneeId }))
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Card_Deleted(this.toDTO()))
  }
}
