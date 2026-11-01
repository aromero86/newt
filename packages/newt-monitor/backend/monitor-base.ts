import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'
import { MemoryRateLimitStore, type RateLimitStore } from 'newt/port-rate-limit'
import { Base, type BaseOptions } from 'newt/runtime'

/**
 * What every module of the monitor receives: newt's base, on SQLite, with the router
 * its context serves, where each module registers its routes (`<m>.routes.ts`).
 *
 * Its rate limits, its modules' and its routers', count in its memory: the monitor is
 * one process. Only what anyone may ask is limited; what the one person asks, signed
 * in, is not.
 */
export class MonitorBase extends Base<SqliteStore> {
  readonly rateLimitStore: RateLimitStore
  readonly clock: BaseOptions<SqliteStore>['clock']
  readonly http: HttpRouter

  constructor(options: BaseOptions<SqliteStore>) {
    const rateLimits = options.rateLimits ?? new MemoryRateLimitStore()
    super({ ...options, rateLimits })
    this.rateLimitStore = rateLimits
    this.clock = options.clock
    this.http = new HttpRouter({ rateLimits, clock: options.clock })
  }
}
