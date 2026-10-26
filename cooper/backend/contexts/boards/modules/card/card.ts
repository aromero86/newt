import { Entity, type EntityInput } from 'newt/core'
import { CardSchema, type CardDTO } from './card.schema'

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
    return new Card(input, true)
  }

  get workspaceId(): string {
    return this.data.workspaceId
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
   * between.
   */
  place(number: number, position: number): void {
    if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
    this.change({ number, position })
  }

  edit(changes: { title?: string, description?: string }): void {
    this.change(changes)
  }

  /** Someone moved it: to this column, at this position. */
  moveTo(columnId: string, position: number): void {
    this.change({ columnId, position })
  }

  /** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

  /** To a member of its workspace: the module checked they are. */
  assign(assigneeId: string): void {
    this.change({ assigneeId })
  }

  unassign(): void {
    this.change({ assigneeId: null })
  }

  delete(): void {
    this.markAsDeleted()
  }
}
