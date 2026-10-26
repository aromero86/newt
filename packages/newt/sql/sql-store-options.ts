export type SqlStoreOptions = {
  /** Where the database is: `postgres://user:password@host:5432/db`, `mysql://…`. */
  url: string
  /** The folder of the context's migrations, SQL files in its database's dialect; none for a store with no tables of its own. */
  migrations?: string
  /** How many connections it keeps: 10 by default. */
  connections?: number
  /** How long a guard waits for a key another transaction holds before it gives up: 30 s by default. */
  waitTimeoutMs?: number
}
