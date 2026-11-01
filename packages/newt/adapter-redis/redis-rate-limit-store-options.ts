export type RedisRateLimitStoreOptions = {
  /** The Redis every instance shares: `redis://host:6379`. */
  url: string
  /** What every key it writes begins with, so several applications share one Redis: `newt:rate` unless told. */
  prefix?: string
}
