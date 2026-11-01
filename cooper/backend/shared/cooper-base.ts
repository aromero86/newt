import { HttpRouter } from 'newt-kit/http'
import { TableRateLimitStore, type RateLimitRow, type RateLimitStore } from 'newt-kit/port-rate-limit'
import { Base, type BaseOptions } from 'newt-kit/runtime'
import type { CooperStore } from './open-store'
import { API_LIMIT } from './rate-limits'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite or Postgres, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 *
 * Its rate limits, its modules' and its routers', count in its store's `rate_limit`
 * table, which every instance on the same database shares, unless it is given where;
 * each person may ask its API `API_LIMIT`.
 */
export class CooperBase extends Base<CooperStore> {
  readonly rateLimitStore: RateLimitStore
  readonly http: HttpRouter

  constructor(options: BaseOptions<CooperStore>) {
    const rateLimits = options.rateLimits ?? new TableRateLimitStore(options.store.table<RateLimitRow>('rate_limit'))
    super({ ...options, rateLimits })
    this.rateLimitStore = rateLimits
    this.http = new HttpRouter({ rateLimits, clock: options.clock, rateLimit: API_LIMIT })
  }
}
