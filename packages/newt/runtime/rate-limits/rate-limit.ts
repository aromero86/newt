import { TooManyRequests, type Clock } from '../../core'
import type { RateLimitRule, RateLimitStore, RateLimitTake } from '../../port-rate-limit'

/**
 * How often one key may do something, as a module defines it (`base.rateLimits.define`):
 * a use case takes from it before what it guards, and `TooManyRequests` (a 429) stops
 * it past the limit. The key is whose turn it is: an email, a workspace, an address.
 */
export class RateLimit {

  constructor(
    readonly name: string,
    readonly rule: RateLimitRule,
    private readonly store: RateLimitStore,
    private readonly context: string,
    private readonly clock: Clock,
  ) {}

  /** One take of `key`: `TooManyRequests` past the limit, with how long to wait. */
  async take(key: string): Promise<RateLimitTake> {
    const take = await this.store.take(this.keyOf(key), this.rule, this.clock.now())
    if (!take.allowed) throw new TooManyRequests(this.name, take.retryAfterMs)
    return take
  }

  /** Forgets what `key` did, as a sign-in that worked forgets the attempts before it. */
  forget(key: string): Promise<void> {
    return this.store.forget(this.keyOf(key))
  }

  /** The store's key: the context's and the limit's name before the key, so no two limits share a count. */
  private keyOf(key: string): string {
    return `${this.context}:${this.name}:${key}`
  }
}
