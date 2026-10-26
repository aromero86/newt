import { Entity, type EntityInput } from 'newt/core'
import { ColumnSchema, type ColumnDTO } from './column.schema'
import { Column_Added } from './events/column-added'
import { Column_Moved } from './events/column-moved'
import { Column_Removed } from './events/column-removed'
import { Column_Renamed } from './events/column-renamed'

export * from './column.schema'

/** A column of a board. */
export class Column extends Entity<typeof ColumnSchema> {

  private constructor(input: EntityInput<ColumnDTO>, isNew: boolean) {
    super(ColumnSchema, input, isNew)
  }

  static fromDTO(dto: ColumnDTO & { version: number }): Column {
    return new Column(dto, false)
  }

  /** A new one, at the end of its board: `position` is where the end looked to be, and its save places it for sure. */
  static add(input: { workspaceId: string, boardId: string, name: string, position: number }): Column {
    const column = new Column(input, true)
    column.trackEvent(new Column_Added(column.toDTO()))
    return column
  }

  get boardId(): string {
    return this.data.boardId
  }

  get position(): number {
    return this.data.position
  }

  /** A new one takes its place as it is saved: the end of its board, read where no other column can be added in between. */
  place(position: number): void {
    if (!this.isNew) throw new Error(`Column ${this.id} is placed once, as it is added`)
    this.change({ position })
    this.trackEvent(new Column_Added(this.toDTO()))
  }

  rename(name: string): void {
    this.change({ name })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Column_Renamed({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Someone moved it: where it goes. */
  moveTo(position: number): void {
    this.change({ position })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Column_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Another one moved, or left: this one takes the place left to it, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

  remove(): void {
    this.markAsDeleted()
    this.trackEvent(new Column_Removed(this.toDTO()))
  }
}
