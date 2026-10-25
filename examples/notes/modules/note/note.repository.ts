import { TableRepository } from 'newt/repository'
import type { NotesBase } from '../../notes-base'
import { NoteTitleTaken } from './errors/note-title-taken'
import { Note, type NoteDTO } from './note'

/** A note as its table keeps it. */
export type NoteRow = NoteDTO & { version: number, deletedAt: string | null }

/** The notes: finding, paging and saving come from the framework, on any store. */
export class Note_Repository extends TableRepository<Note, NoteRow, NotesBase> {

  constructor(base: NotesBase) {
    super(base, base.store.table<NoteRow>('note', { types: { archived: 'boolean' } }), { softDelete: true })
  }

  protected toEntity(row: NoteRow): Note {
    return Note.fromDTO(row)
  }

  /**
   * Saves a note only if its author has no other one with its title, whatever the
   * case: checked after the write, in its transaction, where no other save can slip
   * in between. Two people saving the same title at once cannot both get it.
   */
  async persistWithTitleFree(note: Note): Promise<void> {
    await this.save([note], each => this.write(each), { after: async () => {
      const { authorId, title } = note.toDTO()
      if (await this.count({ authorId, title: { ieq: title } }) > 1) throw new NoteTitleTaken(title)
    } })
  }
}
