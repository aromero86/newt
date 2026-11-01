import { Entity, now, type EntityInput } from '@newt-kit/newt/core'
import { ConnectionSchema, type ConnectionDTO, type FailureDTO, type IdentityDTO } from './connection.schema'
import { Connection_Lost } from './events/connection-lost'
import { Connection_Restored } from './events/connection-restored'

export * from './connection.schema'

/** What one call to an application came to: it answered (with its identity, when asked), or why not. */
export type Outcome = { answered: true, identity?: IdentityDTO } | { answered: false, failure: FailureDTO }

/**
 * Whether an application answers. Each call to it is recorded; going down tells
 * `connection.lost`, coming back up `connection.restored`.
 */
export class Connection extends Entity<typeof ConnectionSchema> {

  private constructor(input: EntityInput<ConnectionDTO>, isNew: boolean) {
    super(ConnectionSchema, input, isNew)
  }

  static fromDTO(dto: ConnectionDTO & { version: number }): Connection {
    return new Connection(dto, false)
  }

  /** The first call to an application. */
  static first(appId: string, outcome: Outcome): Connection {
    const connection = new Connection({ appId, status: 'down', identity: null, failure: null, checkedAt: now().toISOString(), lastSeenAt: null }, true)
    connection.record(outcome, true)
    return connection
  }

  /** A call to it, and what it came to. */
  record(outcome: Outcome, first = false): void {
    const at = now().toISOString()
    const wasDown = !first && this.data.status === 'down'
    if (outcome.answered) {
      this.change({ status: 'up', failure: null, checkedAt: at, lastSeenAt: at, ...(outcome.identity ? { identity: outcome.identity } : {}) })
      if (wasDown) this.trackEvent(new Connection_Restored({ appId: this.data.appId, failure: null }))
    } else {
      const wasUp = first || this.data.status === 'up'
      this.change({ status: 'down', failure: outcome.failure, checkedAt: at })
      if (wasUp) this.trackEvent(new Connection_Lost({ appId: this.data.appId, failure: outcome.failure }))
    }
  }
}
