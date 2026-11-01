import { Entity, type EntityInput } from 'newt-kit/core'
import { UseCaseErrorsFeedSchema, type UseCaseErrorsFeedDTO } from './use-case-errors.schema'

export * from './use-case-errors.schema'

/** What the monitor has collected of how one application's use case calls ended: its cursor. */
export class UseCaseErrorsFeed extends Entity<typeof UseCaseErrorsFeedSchema> {

  private constructor(input: EntityInput<UseCaseErrorsFeedDTO>, isNew: boolean) {
    super(UseCaseErrorsFeedSchema, input, isNew)
  }

  static fromDTO(dto: UseCaseErrorsFeedDTO & { version: number }): UseCaseErrorsFeed {
    return new UseCaseErrorsFeed(dto, false)
  }

  /** Before its first collection. */
  static start(appId: string): UseCaseErrorsFeed {
    return new UseCaseErrorsFeed({ appId, until: null }, true)
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
