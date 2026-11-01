import { MemoryRateLimitStore } from '../memory-rate-limit-store'
import { describeRateLimitContract } from './describe-rate-limit-contract'

describeRateLimitContract('MemoryRateLimitStore', { open: async () => new MemoryRateLimitStore() })
