import type { NotesBase } from '../../notes-base'
import type { Note_Module } from './note.module'

/**
 * What the module does in reaction to its events. As a `handler` each reaction
 * is a job, written with the change that caused it: it runs after the commit, again
 * if it fails, and never for a change that rolled back.
 */
export function registerNoteWorkers(_base: NotesBase, notes: Note_Module): void {
  notes.events.created.subscribe(note => notes.recordActivity(note.id, 'created', note.createdAt), {
    strategy: 'handler',
    queue: 'note.recordActivity.on.note.created',
  })
  notes.events.updated.subscribe(({ dto }) => notes.recordActivity(dto.id, 'updated', dto.updatedAt), {
    strategy: 'handler',
    queue: 'note.recordActivity.on.note.updated',
  })
}
