/** How a SQL table runs its statements, whatever the driver: in the transaction in progress, or outside one. */
export type SqlExecutor = {
  all(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>
  /** How many rows it changed. */
  run(sql: string, params: unknown[]): Promise<number>
  /**
   * Runs `fn` in a transaction, or in the one in progress, so that if it fails the
   * transaction goes on without what it did (a savepoint, where a failed statement
   * would spoil the whole transaction, as in Postgres).
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>
}
