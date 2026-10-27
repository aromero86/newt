import { RedisClient } from 'bun'

/**
 * Where the monitor's endpoint keeps the nonces it has seen, so a signed request sent
 * twice is refused the second time: in its own memory (`MemoryNonces`, one instance),
 * or in Redis (`RedisNonces`), so a request is refused by every instance once any saw it.
 */
export interface NonceStore {
  /** Keeps a nonce until a time (epoch ms); false if it was kept already. */
  remember(nonce: string, until: number, now: number): Promise<boolean>
}

export class MemoryNonces implements NonceStore {

  /** Each nonce seen, until when it is kept. */
  private readonly seen = new Map<string, number>()

  async remember(nonce: string, until: number, now: number): Promise<boolean> {
    for (const [each, kept] of this.seen) if (kept < now) this.seen.delete(each)
    if (this.seen.has(nonce)) return false
    this.seen.set(nonce, until)
    return true
  }
}

export class RedisNonces implements NonceStore {

  private readonly redis: RedisClient

  constructor(options: { url: string, prefix?: string }) {
    this.redis = new RedisClient(options.url)
    this.prefix = options.prefix ?? 'newt:monitor:nonce'
  }

  private readonly prefix: string

  async remember(nonce: string, until: number, now: number): Promise<boolean> {
    // Set only if it was not: one instance's yes is every other's no.
    return (await this.redis.set(`${this.prefix}:${nonce}`, '1', 'PX', String(Math.max(1, until - now)), 'NX')) === 'OK'
  }

  close(): void {
    this.redis.close()
  }
}
