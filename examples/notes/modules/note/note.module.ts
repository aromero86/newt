import { currentActor, eventsOf, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { NotesBase } from '../../notes-base'
import { NoteNotFound } from './errors/note-not-found'
import { NoteTitleTaken } from './errors/note-title-taken'
import { Note_Created } from './events/note-created'
import { Note_Deleted } from './events/note-deleted'
import { Note_Updated } from './events/note-updated'
import { Note, NoteCreateSchema, NoteFiltersSchema, NoteUpdateSchema, type NoteCreateDTO, type NoteDTO, type NoteFiltersDTO, type NoteUpdateDTO } from './note'
import { Note_Repository } from './note.repository'
import { registerNoteRoutes } from './note.routes'
import { registerNoteWorkers } from './note.workers'

/** The notes people write. Each one changes only its own. */
export class Note_Module extends Module {

  static initialize(base: NotesBase): Note_Module {
    const module = new Note_Module(base, new Note_Repository(base))
    registerNoteRoutes(base, module)
    registerNoteWorkers(base, module)
    return module
  }

  readonly events

  private constructor(base: NotesBase, private readonly repo: Note_Repository) {
    super('note', base.invocations)
    this.events = eventsOf(base.bus, { created: Note_Created, updated: Note_Updated, deleted: Note_Deleted })
  }

  /** A page of the actor's notes that pass the filters, in the order they were written. */
  @UseCase()
  async list(filters: NoteFiltersDTO, page: PageRequest): Promise<Page<NoteDTO>> {
    const found = await this.repo.page({ authorId: currentActor().userId, ...NoteFiltersSchema.parse(filters) }, page)
    return {
      items: found.items.map(note => note.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  @UseCase()
  async get(id: string): Promise<NoteDTO> {
    return (await this.load(id)).toDTO()
  }

  @UseCase()
  async create(input: NoteCreateDTO): Promise<NoteDTO> {
    const { title, body } = NoteCreateSchema.parse(input)
    await this.assertTitleFree(title)
    const note = Note.create({ title, body, authorId: currentActor().userId })
    await this.repo.persistWithTitleFree(note)
    return note.toDTO()
  }

  /** Run again from the start if someone saved the note in between. */
  @UseCase({ retryOnConflict: true })
  async update(id: string, input: NoteUpdateDTO): Promise<NoteDTO> {
    const changes = NoteUpdateSchema.parse(input)
    const note = await this.load(id)
    if (changes.title !== undefined) await this.assertTitleFree(changes.title, id)
    note.update(changes)
    await this.repo.persistWithTitleFree(note)
    return note.toDTO()
  }

  @UseCase({ retryOnConflict: true })
  async delete(id: string): Promise<void> {
    const note = await this.load(id)
    note.delete()
    await this.repo.persist(note)
  }

  /** Notes down that something happened to a note: what the workers call. */
  @UseCase()
  async recordActivity(noteId: string, what: string, at: string): Promise<void> {
    await this.repo.recordActivity(noteId, what, at)
  }

  private load(id: string): Promise<Note> {
    return this.resolve(() => this.repo.find({ id, authorId: currentActor().userId }), () => new NoteNotFound(id))
  }

  /** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
  private async assertTitleFree(title: string, exceptId?: string): Promise<void> {
    const taken = await this.repo.count({ authorId: currentActor().userId, title: { ieq: title }, id: exceptId === undefined ? undefined : { ne: exceptId } })
    if (taken > 0) throw new NoteTitleTaken(title)
  }
}
