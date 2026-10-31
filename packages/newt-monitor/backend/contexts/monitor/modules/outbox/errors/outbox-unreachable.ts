import { ConflictError } from 'newt/core'

/** The application did not answer when asked for its dead jobs: nothing to show, and why. */
export class OutboxUnreachable extends ConflictError {
  readonly code = 'outbox.unreachable'
}
