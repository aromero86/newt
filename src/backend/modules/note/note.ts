import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { Note_Created } from './events/note-created'
import { Note_Deleted } from './events/note-deleted'
import { Note_Updated } from './events/note-updated'
import { NoteSchema, type NoteDTO } from './note.schema'

export * from './note.schema'

export class Note extends Entity<typeof NoteSchema> {

  private constructor(input: EntityInput<NoteDTO>, isNew: boolean) {
    super(NoteSchema, input, isNew)
  }

  /** Rebuilds a stored note: nothing new happened. */
  static fromDTO(dto: NoteDTO): Note {
    return new Note(dto, false)
  }

  static create(input: EntityInput<NoteDTO>): Note {
    const note = new Note(input, true)
    note.trackEvent(new Note_Created(note.toDTO()))
    return note
  }

  update(changes: Partial<Omit<NoteDTO, 'id'>>): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Note_Updated({ dto: this.toDTO(), changes: diff }))
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Note_Deleted(this.toDTO()))
  }
}
