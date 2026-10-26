import { sql, type Expression, type SqlBool } from 'kysely'
import { criteriaTree, type Criteria } from '../core'
import { mysqlDialect } from '../adapter-mysql/internal'
import { postgresDialect } from '../adapter-postgres/internal'
import { SqliteStore } from '../adapter-sqlite'
import { sqliteDialect } from '../adapter-sqlite/internal'
import type { SqlDialect, SqlStore } from '../sql'
import { whereClause } from '../sql/internal'

/** How a column or a parameter is marked in the condition the stores write, for Kysely to write its own there. */
const MARK = /\u0001([cp])(\d+)\u0001/

/**
 * Criteria as a condition of Kysely, said as the store's tables say it: every
 * operator and group, and null, case and the rest answered as `find` answers them.
 * Its fields are the rows' (`boardId`), of the table queried.
 *
 * ```ts
 * db.selectFrom('card').selectAll().where(whereOf(store, { boardId, number: { gt: 10 } }))
 * ```
 */
export function whereOf<Row>(store: SqliteStore | SqlStore, criteria: Criteria<Row>): Expression<SqlBool> {
  const dialect = dialectOf(store)
  const fields: string[] = []
  const params: unknown[] = []
  const text = whereClause(criteriaTree(criteria), {
    // Marked, not written: Kysely writes the column (its plugins name it) and the parameter.
    dialect: { ...dialect, param: n => `\u0001p${n}\u0001`, quote: column => column },
    column: field => `\u0001c${fields.push(field) - 1}\u0001`,
    value: (_, operand) => (typeof operand === 'boolean' ? dialect.boolean(operand) : operand),
  }, params)
  // Split by a mark, its text is every third part, each mark's kind and number after it.
  const parts = text.split(MARK)
  const pieces: Expression<unknown>[] = []
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) pieces.push(sql.raw(parts[i]!))
    if (i + 2 < parts.length) {
      const n = Number(parts[i + 2])
      pieces.push(parts[i + 1] === 'c' ? sql.ref(fields[n]!) : sql.val(params[n - 1]))
    }
  }
  return sql.join(pieces, sql.raw('')).$castTo<SqlBool>()
}

function dialectOf(store: SqliteStore | SqlStore): SqlDialect {
  if (store instanceof SqliteStore) return sqliteDialect
  return store.database === 'postgres' ? postgresDialect : mysqlDialect
}
