import type { RateLimitRule } from './rate-limit-rule'
import type { RateLimitTake } from './rate-limit-take'
import type { WindowCount } from './window-count'

/**
 * One take of a key at `at`: what it did lately moved to the window `at` is in, and the
 * take counted if the rule lets it through. A store keeps what it answers as `count`.
 *
 * The window before counts as much as it still overlaps the last `windowMs`: halfway
 * through a window, half of what the one before took.
 */
export function slide(count: WindowCount | null, { limit, windowMs }: RateLimitRule, at: Date): { count: WindowCount, take: RateLimitTake } {
  const now = at.getTime()
  const start = Math.floor(now / windowMs) * windowMs
  const moved = !count || count.start < start - windowMs
    ? { start, count: 0, previous: 0 }
    : count.start < start
      ? { start, count: 0, previous: count.count }
      : count
  const elapsed = now - start
  const used = moved.previous * (1 - elapsed / windowMs) + moved.count
  if (used + 1 <= limit) {
    return { count: { ...moved, count: moved.count + 1 }, take: { allowed: true, limit, remaining: Math.floor(limit - used - 1), retryAfterMs: 0 } }
  }
  return { count: moved, take: { allowed: false, limit, remaining: 0, retryAfterMs: waitFor(moved, limit, windowMs, elapsed) } }
}

/** How long until a take of a key refused now would be let through. */
function waitFor({ count, previous }: WindowCount, limit: number, windowMs: number, elapsed: number): number {
  // The window in progress is full by itself: wait for the next, until enough of this one has slid away.
  if (count >= limit) return Math.max(1, Math.ceil(windowMs - elapsed + windowMs * (1 - (limit - 1) / count)))
  // Only the one before is in the way: wait until enough of it has slid away.
  return Math.max(1, Math.ceil(windowMs * (1 - (limit - 1 - count) / previous) - elapsed))
}

/** A rule that cannot count anything is a mistake of whoever wrote it. */
export function checkRule({ limit, windowMs }: RateLimitRule): void {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`A rate limit's limit is a whole number from 1: ${limit}`)
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error(`A rate limit's window is a whole number of milliseconds from 1: ${windowMs}`)
}
