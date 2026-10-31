import { Entity, type EntityInput } from 'newt/core'
import { LOST_AFTER_MS, type InstanceState } from 'newt/runtime'
import { InstanceSchema, InstancesFeedSchema, type InstanceDTO, type InstanceRowDTO, type InstanceStatus, type InstancesFeedDTO } from './instances.schema'

export * from './instances.schema'

/** How often the monitor collects: an instance not heard of for longer than this, and its own silence, is lost. */
const COLLECTED_EVERY_MS = 60_000

/** What the monitor has collected of one application's instances: its cursor. */
export class InstancesFeed extends Entity<typeof InstancesFeedSchema> {

  private constructor(input: EntityInput<InstancesFeedDTO>, isNew: boolean) {
    super(InstancesFeedSchema, input, isNew)
  }

  static fromDTO(dto: InstancesFeedDTO & { version: number }): InstancesFeed {
    return new InstancesFeed(dto, false)
  }

  /** Before its first collection. */
  static start(appId: string): InstancesFeed {
    return new InstancesFeed({ appId, until: null }, true)
  }

  get appId(): string {
    return this.data.appId
  }

  get until(): string | null {
    return this.data.until
  }

  /** Collected up to a minute: the next collection asks from it. */
  collectedUntil(until: string): void {
    if (this.data.until === null || until > this.data.until) this.change({ until })
  }
}

/** One instance of an application, as it was last collected. */
export class Instance extends Entity<typeof InstanceSchema> {

  private constructor(input: EntityInput<InstanceRowDTO>, isNew: boolean) {
    super(InstanceSchema, input, isNew)
  }

  static fromDTO(dto: InstanceRowDTO & { version: number }): Instance {
    return new Instance(dto, false)
  }

  /** The first time the monitor hears of it. */
  static heard(appId: string, state: InstanceState): Instance {
    return new Instance({ appId, ...Instance.fields(state) }, true)
  }

  get instanceId(): string {
    return this.data.instanceId
  }

  get server(): string {
    return this.data.server.name
  }

  /** Gone since: when it stopped, or was last heard of; null while alive. */
  goneSince(now: Date): string | null {
    const status = this.statusAt(now)
    return status === 'alive' ? null : this.data.stoppedAt ?? this.data.lastSeenAt
  }

  /** As the application tells it now: a sample older than the one kept changes nothing. */
  heardAgain(state: InstanceState): void {
    if (state.lastSeenAt < this.data.lastSeenAt || (state.lastSeenAt === this.data.lastSeenAt && state.status === this.data.status)) return
    this.change(Instance.fields(state))
  }

  /**
   * Its status now: as the application said it, but lost once neither it nor the
   * application has been heard of for longer than an instance may stay silent and a
   * collection may take.
   */
  statusAt(now: Date): InstanceStatus {
    if (this.data.status !== 'alive') return this.data.status
    return now.getTime() - Date.parse(this.data.lastSeenAt) > LOST_AFTER_MS + COLLECTED_EVERY_MS ? 'lost' : 'alive'
  }

  /** For a client, with its status now. */
  view(now: Date): InstanceDTO {
    const { instanceId, pid, startedAt, lastSeenAt, stoppedAt, process, server } = this.data
    return { instanceId, pid, startedAt, lastSeenAt, status: this.statusAt(now), stoppedAt, process, server: server.name }
  }

  /** Its last reading of its server. */
  get reading(): InstanceRowDTO['server'] {
    return this.data.server
  }

  get lastSeenAt(): string {
    return this.data.lastSeenAt
  }

  private static fields(state: InstanceState) {
    return {
      instanceId: state.instance, pid: state.pid, startedAt: state.startedAt, lastSeenAt: state.lastSeenAt,
      status: state.status, stoppedAt: state.stoppedAt, process: state.process, server: state.server,
    }
  }
}
