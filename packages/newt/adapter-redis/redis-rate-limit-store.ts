import { RedisClient } from 'bun'
import { checkRule, slide, type RateLimitRule, type RateLimitStore, type RateLimitTake, type WindowCount } from '../port-rate-limit'
import type { RedisRateLimitStoreOptions } from './redis-rate-limit-store-options'

/** How many times a take reads again when another instance took the same key meanwhile. */
const ATTEMPTS = 10

/** Writes the key's new count only if it still holds the one read (none: `''`), forgotten once both windows slid away. */
const SWAP = `
local current = redis.call('GET', KEYS[1])
if (current == false and ARGV[1] == '') or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`

/**
 * A rate limit store on Redis, for several instances: each key's count is one Redis
 * key, read and written again only if no other instance wrote it meanwhile, and gone
 * on its own once its windows slid away.
 */
export class RedisRateLimitStore implements RateLimitStore {

  private readonly redis: RedisClient
  private readonly prefix: string

  constructor(options: RedisRateLimitStoreOptions) {
    this.redis = new RedisClient(options.url)
    this.prefix = options.prefix ?? 'newt:rate'
  }

  async take(key: string, rule: RateLimitRule, at: Date): Promise<RateLimitTake> {
    checkRule(rule)
    const redisKey = this.key(key)
    for (let attempt = 1; ; attempt++) {
      const read = await this.redis.get(redisKey)
      const { count, take } = slide(read ? JSON.parse(read) as WindowCount : null, rule, at)
      if (!take.allowed) return take
      const forgetInMs = Math.max(1, count.start + 2 * rule.windowMs - at.getTime())
      const swapped = await this.redis.send('EVAL', [SWAP, '1', redisKey, read ?? '', JSON.stringify(count), String(forgetInMs)])
      if (swapped === 1) return take
      if (attempt === ATTEMPTS) throw new Error(`Rate limit: ${key} was taken by others ${ATTEMPTS} times in a row`)
    }
  }

  async forget(key: string): Promise<void> {
    await this.redis.del(this.key(key))
  }

  close(): void {
    this.redis.close()
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`
  }
}
