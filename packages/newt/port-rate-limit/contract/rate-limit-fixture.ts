import type { RateLimitStore } from '../../port-rate-limit'

/** How the rate limit suite gets a fresh, empty store of an adapter, and closes it. */
export type RateLimitFixture<S extends RateLimitStore = RateLimitStore> = {
  open(): Promise<S>
  close?(store: S): Promise<void>
}
