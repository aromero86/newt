import { describe } from 'bun:test'
import { describeRateLimitContract } from '../port-rate-limit/contract'
import { RedisRateLimitStore } from './redis-rate-limit-store'

// Against a real Redis, when there is one: REDIS_URL=redis://localhost:6379 bun test.
const url = process.env.REDIS_URL
const prefix = `newt:test:${crypto.randomUUID()}`

describe.skipIf(!url)('RedisRateLimitStore', () => {
  describeRateLimitContract('RedisRateLimitStore', {
    open: async () => new RedisRateLimitStore({ url: url!, prefix }),
    close: async store => store.close(),
  })
})
