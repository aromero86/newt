import type { DomainEvent } from 'newt/core'
import type { NoteDTO } from '../note.schema'

/** The whole note as it is now, the fields that changed, and what they were before. */
type NoteChange = { dto: NoteDTO, changes: Partial<NoteDTO>, previous: Partial<NoteDTO> }

export class Note_Updated implements DomainEvent<NoteChange> {
  static readonly eventName = 'note.updated'
  readonly name = Note_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: NoteChange) {}
}
