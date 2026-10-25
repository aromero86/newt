import type { DomainEvent } from 'newt/core'
import type { NoteDTO } from '../note.schema'

export class Note_Deleted implements DomainEvent<NoteDTO> {
  static readonly eventName = 'note.deleted'
  readonly name = Note_Deleted.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: NoteDTO) {}
}
