import type { DomainEvent } from '../../../core/events/domain-event'
import type { NoteDTO } from '../note.schema'

/** The whole note as it is now, and only the fields that changed. */
export class Note_Updated implements DomainEvent<{ dto: NoteDTO, changes: Partial<NoteDTO> }> {
  static readonly eventName = 'note.updated'
  readonly name = Note_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: { dto: NoteDTO, changes: Partial<NoteDTO> }) {}
}
