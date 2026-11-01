import type { Clock } from '../../core'
import { checkRule, type RateLimitRule, type RateLimitStore } from '../../port-rate-limit'
import { RateLimit } from './rate-limit'

/** `<module>.<name>`, as a schedule is named: `session.signIn`. */
const NAME = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/

/**
 * A context's rate limits, each counted in its store (`BaseOptions.rateLimits`): in
 * memory unless told, so with several instances it is a table or Redis they share.
 *
 * ```ts
 * this.signIns = base.rateLimits.define('session.signIn', { limit: 5, windowMs: 15 * MINUTE })
 * // in the use case, before checking the password:
 * await this.signIns.take(email)
 * ```
 */
export class RateLimits {

  private readonly limits = new Map<string, RateLimit>()

  constructor(
    private readonly store: RateLimitStore,
    private readonly context: string,
    private readonly clock: Clock,
  ) {}

  /** A limit of the context, named `<module>.<name>`: at most `rule.limit` takes of a key in any `rule.windowMs`. */
  define(name: string, rule: RateLimitRule): RateLimit {
    if (!NAME.test(name)) throw new Error(`A rate limit is named <module>.<name>, as session.signIn: ${name}`)
    if (this.limits.has(name)) throw new Error(`Rate limit ${name} is defined twice`)
    checkRule(rule)
    const limit = new RateLimit(name, rule, this.store, this.context, this.clock)
    this.limits.set(name, limit)
    return limit
  }
}
