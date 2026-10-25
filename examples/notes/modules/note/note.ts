import { Entity, type EntityInput } from 'newt/core'
import { Note_Created } from './events/note-created'
import { Note_Deleted } from './events/note-deleted'
import { Note_Updated } from './events/note-updated'
import { NoteSchema, type NoteDTO } from './note.schema'

export * from './note.schema'

/** A note someone wrote. */
export class Note extends Entity<typeof NoteSchema> {

  private constructor(input: EntityInput<NoteDTO>, isNew: boolean) {
    super(NoteSchema, input, isNew)
  }

  /** One that is stored: nothing happened. */
  static fromDTO(dto: NoteDTO): Note {
    return new Note(dto, false)
  }

  /** One that did not exist: its id and timestamps are given here. */
  static create(input: { title: string, body: string, authorId: string }): Note {
    const note = new Note({ ...input, archived: false }, true)
    note.trackEvent(new Note_Created(note.toDTO()))
    return note
  }

  update(changes: Partial<Pick<NoteDTO, 'title' | 'body' | 'archived'>>): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Note_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Note_Deleted(this.toDTO()))
  }
}
