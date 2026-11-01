import type { RateLimitRule } from './rate-limit-rule'
import type { RateLimitStore } from './rate-limit-store'
import type { RateLimitTake } from './rate-limit-take'
import { checkRule, slide } from './slide'
import type { WindowCount } from './window-count'

const MINUTE = 60_000

/**
 * A rate limit store in the process's memory: enough for one instance. With several,
 * each would count only what it saw; they share `TableRateLimitStore` or Redis's.
 * Keys whose windows have slid away are forgotten as new takes come, at most once a minute.
 */
export class MemoryRateLimitStore implements RateLimitStore {

  private readonly counts = new Map<string, { count: WindowCount, forgetAt: number }>()
  private sweptAt = 0

  async take(key: string, rule: RateLimitRule, at: Date): Promise<RateLimitTake> {
    checkRule(rule)
    this.sweep(at.getTime())
    const { count, take } = slide(this.counts.get(key)?.count ?? null, rule, at)
    this.counts.set(key, { count, forgetAt: count.start + 2 * rule.windowMs })
    return take
  }

  async forget(key: string): Promise<void> {
    this.counts.delete(key)
  }

  private sweep(now: number): void {
    if (now - this.sweptAt < MINUTE) return
    this.sweptAt = now
    for (const [key, { forgetAt }] of this.counts) if (forgetAt <= now) this.counts.delete(key)
  }
}
