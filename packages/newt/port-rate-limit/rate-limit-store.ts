import type { RateLimitRule } from './rate-limit-rule'
import type { RateLimitTake } from './rate-limit-take'

/**
 * Where what each key did lately is counted, so a rate limit holds across every
 * process that shares it: `MemoryRateLimitStore` for one, `TableRateLimitStore` on the
 * context's store or `RedisRateLimitStore` (newt/adapter-redis) for several.
 *
 * A key is counted in a sliding window: the takes of the window in progress, plus
 * those of the one before as much as it still overlaps. A take refused is not counted.
 */
export interface RateLimitStore {
  /** One take of `key` at `at` under `rule`, counted only when it is let through. */
  take(key: string, rule: RateLimitRule, at: Date): Promise<RateLimitTake>
  /** Forgets what `key` did: its next take starts afresh, as after a sign-in that worked. */
  forget(key: string): Promise<void>
}
