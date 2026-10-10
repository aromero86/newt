import type { DomainEvent } from '../../../core/events/domain-event'
import type { NoteDTO } from '../note.schema'

export class Note_Created implements DomainEvent<NoteDTO> {
  static readonly eventName = 'note.created'
  readonly name = Note_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: NoteDTO) {}
}
