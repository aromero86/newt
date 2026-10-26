import type { Database, Statement } from 'bun:sqlite'

/** How many statements one Kysely keeps prepared: the ones used last. */
const KEPT = 200

/**
 * The statements of one Kysely on a SQLite store: its own, prepared on the store's
 * connection (each runs on the connection it should when it runs), never the
 * connection's cached ones, which the application's code shares when it runs the
 * same SQL: a read of it left halfway would be started over. The ones used last are
 * kept; one let go is finalized.
 */
export class SqliteStatements {

  /** By their SQL, the one used last at the end. */
  private readonly prepared = new Map<string, Statement>()

  constructor(private readonly connection: Database) {}

  get(sql: string): Statement {
    const statement = this.prepared.get(sql) ?? this.connection.prepare(sql)
    this.prepared.delete(sql)
    this.prepared.set(sql, statement)
    if (this.prepared.size > KEPT) {
      const [text, oldest] = this.prepared.entries().next().value!
      this.prepared.delete(text)
      oldest.finalize()
    }
    return statement
  }

  /** Finalizes every one: Kysely is destroyed. */
  finalize(): void {
    for (const statement of this.prepared.values()) statement.finalize()
    this.prepared.clear()
  }
}
