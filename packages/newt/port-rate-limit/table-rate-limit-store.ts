import { ConcurrencyConflict, DuplicateValue } from '../core'
import type { Table } from '../port-store'
import type { RateLimitRow } from './rate-limit-row'
import type { RateLimitRule } from './rate-limit-rule'
import type { RateLimitStore } from './rate-limit-store'
import type { RateLimitTake } from './rate-limit-take'
import { checkRule, slide } from './slide'

const MINUTE = 60_000

/** How many times a take reads again when another took the same key meanwhile. */
const ATTEMPTS = 10

const sha256 = (data: string) => new Bun.CryptoHasher('sha256').update(data).digest('hex')

/**
 * A rate limit store on a table of any store, `store.table<RateLimitRow>('rate_limit')`:
 * every process that shares the store shares the counts, without a Redis. Each take
 * is a read and a write of the key's row, at its version: two at once, one reads again.
 * Forgotten rows are removed as new takes come, at most once a minute.
 */
export class TableRateLimitStore implements RateLimitStore {

  private purgedAt = 0

  constructor(private readonly table: Table<RateLimitRow>) {}

  async take(key: string, rule: RateLimitRule, at: Date): Promise<RateLimitTake> {
    checkRule(rule)
    await this.purge(at.getTime())
    const id = sha256(key)
    for (let attempt = 1; ; attempt++) {
      const [row] = await this.table.find({ id })
      const { count, take } = slide(row ? { start: Date.parse(row.start), count: row.count, previous: row.previous } : null, rule, at)
      if (!take.allowed) return take
      const changes = { start: new Date(count.start).toISOString(), count: count.count, previous: count.previous, expiresAt: new Date(count.start + 2 * rule.windowMs).toISOString() }
      try {
        if (row) await this.table.update(id, row.version, changes)
        else await this.table.insert({ id, ...changes })
        return take
      } catch (error) {
        if (attempt === ATTEMPTS || !(error instanceof ConcurrencyConflict || error instanceof DuplicateValue)) throw error
      }
    }
  }

  async forget(key: string): Promise<void> {
    await this.table.deleteMany({ id: sha256(key) })
  }

  private async purge(now: number): Promise<void> {
    if (now - this.purgedAt < MINUTE) return
    this.purgedAt = now
    await this.table.deleteMany({ expiresAt: { lte: new Date(now).toISOString() } })
  }
}
