import type { Base } from '../../base/base'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { NoteNotFound } from './errors/note-not-found'
import { Note_Created } from './events/note-created'
import { Note_Deleted } from './events/note-deleted'
import { Note_Updated } from './events/note-updated'
import { CreateNoteSchema, Note, UpdateNoteSchema, type CreateNoteDTO, type UpdateNoteDTO } from './note'
import { Note_Repository, type Note_Criteria } from './note.repository'

/**
 * The example module: a note with a title and a body. It shows every piece a
 * module has and is removed when the first real module arrives.
 */
export class Note_Module extends Module {

  static async initialize(base: Base) {
    return new Note_Module(base, new Note_Repository(base))
  }

  readonly created
  readonly updated
  readonly deleted

  private constructor(base: Base, private readonly repo: Note_Repository) {
    super('note', base.transactions)
    this.created = new DomainEventEmitter(base.bus, Note_Created)
    this.updated = new DomainEventEmitter(base.bus, Note_Updated)
    this.deleted = new DomainEventEmitter(base.bus, Note_Deleted)
  }

  @UseCase('note.find')
  async find(criteria: Note_Criteria, pagination?: { size: number, fromId: string }) {
    const notes = await this.repo.find(criteria, pagination)
    return notes.map(note => note.toDTO())
  }

  @UseCase('note.count')
  async count(criteria: Note_Criteria) {
    return this.repo.count(criteria)
  }

  @UseCase('note.create')
  async create(input: CreateNoteDTO) {
    const note = Note.create(CreateNoteSchema.parse(input))
    await this.repo.persist(note)
    return note.toDTO()
  }

  @UseCase('note.update')
  async update(noteId: string, input: UpdateNoteDTO) {
    const changes = UpdateNoteSchema.parse(input)
    const note = await this.resolve(() => this.repo.find({ id: [noteId] }), () => new NoteNotFound(noteId))

    note.update(changes)
    await this.repo.persist(note)
    return note.toDTO()
  }

  @UseCase('note.delete')
  async delete(noteId: string) {
    const note = await this.resolve(() => this.repo.find({ id: [noteId] }), () => new NoteNotFound(noteId))

    note.delete()
    await this.repo.persist(note)
  }
}
