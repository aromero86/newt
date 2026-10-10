import { Database as Sqlite } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ensureTransaction } from '../../core/unit-of-work/ensure-transaction'
import type { TransactionRunner } from '../../core/unit-of-work/transaction-runner'

const WRITE_METHODS = new Set(['insert', 'update', 'delete', 'run'])

/**
 * The SQLite database. Repositories get a drizzle handle that opens the use case's
 * transaction on its first write; `TransactionManager` commits or rolls it back.
 */
export class Database implements TransactionRunner {

  private readonly writeAware: BunSQLiteDatabase

  private constructor(readonly sqlite: Sqlite) {
    const plain = drizzle(sqlite)
    this.writeAware = new Proxy(plain, {
      get: (target, prop, receiver) => {
        if (WRITE_METHODS.has(prop as string)) {
          const method = Reflect.get(target, prop, target) as (...args: unknown[]) => unknown
          return (...args: unknown[]) => {
            ensureTransaction(() => sqlite.run('BEGIN IMMEDIATE'))
            return method.apply(target, args)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  /** `:memory:` opens a database that lives only as long as the process (tests). */
  static async open(path: string): Promise<Database> {
    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true })

    const sqlite = new Sqlite(path)
    // WAL lets readers go on while a write is in progress, and NORMAL sync is safe
    // with WAL: together they make writes much faster.
    sqlite.run('PRAGMA journal_mode = WAL')
    sqlite.run('PRAGMA synchronous = NORMAL')
    sqlite.run('PRAGMA busy_timeout = 5000')
    sqlite.run('PRAGMA foreign_keys = ON')
    return new Database(sqlite)
  }

  get drizzle(): BunSQLiteDatabase {
    return this.writeAware
  }

  exec(sql: string): void {
    this.sqlite.run(sql)
  }

  close(): void {
    this.sqlite.close()
  }
}
