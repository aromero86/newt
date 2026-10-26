import type { Condition, CriteriaNode } from '../core'
import type { SqlDialect } from './sql-dialect'

/** How criteria meet a table: its columns, and its values as they go in. */
export type WhereContext = {
  dialect: SqlDialect
  column(field: string): string
  value(field: string, operand: unknown): unknown
  /** The column, quoted, as compared by order (`gt`, `lt`…), when not as it is: by code point. */
  ordered?(field: string, quoted: string): string
}

/** Criteria as a SQL condition, its values pushed to `params` in order; `dialect.always` when it asks nothing. */
export function whereClause(node: CriteriaNode, context: WhereContext, params: unknown[]): string {
  const { dialect } = context
  switch (node.kind) {
    case 'all': {
      const parts = node.of.map(each => whereClause(each, context, params)).filter(part => part !== dialect.always)
      return parts.length === 0 ? dialect.always : parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`
    }
    case 'any': {
      const parts = node.of.map(each => whereClause(each, context, params))
      return parts.length === 0 ? dialect.never : parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`
    }
    case 'field': {
      const parts = conditions(node.field, node.condition, context, params)
      return parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`
    }
  }
}

function conditions(field: string, condition: Condition<unknown>, context: WhereContext, params: unknown[]): string[] {
  const { dialect } = context
  const column = dialect.quote(context.column(field))
  const ordered = context.ordered?.(field, column) ?? column
  const value = (operand: unknown) => {
    params.push(context.value(field, operand))
    return dialect.param(params.length)
  }
  // Where text cannot hold NUL, no row holds a value with one: it equals none, and orders as the text before its NUL.
  const nul = (operand: unknown) => dialect.refusesNul === true && typeof operand === 'string' && operand.includes('\u0000')
  const beforeNul = (operand: unknown) => value((operand as string).slice(0, (operand as string).indexOf('\u0000')))
  return Object.entries(condition).map(([operator, operand]) => {
    switch (operator) {
      case 'eq': return operand === null ? `${column} IS NULL` : nul(operand) ? dialect.never : `${column} = ${value(operand)}`
      case 'ne': return operand === null ? `${column} IS NOT NULL` : nul(operand) ? dialect.always : dialect.distinct(column, value(operand))
      case 'in': {
        // SQL's IN never matches null: a null in the list asks for IS NULL beside it.
        const values = (operand as unknown[]).filter(each => each !== null)
        const list = values.filter(each => !nul(each))
        const among = list.length === 0 ? dialect.never : `${column} IN (${list.map(value).join(', ')})`
        return values.length === (operand as unknown[]).length ? among : `(${among} OR ${column} IS NULL)`
      }
      case 'gt': return nul(operand) ? `${ordered} > ${beforeNul(operand)}` : `${ordered} > ${value(operand)}`
      case 'gte': return nul(operand) ? `${ordered} > ${beforeNul(operand)}` : `${ordered} >= ${value(operand)}`
      case 'lt': return nul(operand) ? `${ordered} <= ${beforeNul(operand)}` : `${ordered} < ${value(operand)}`
      case 'lte': return nul(operand) ? `${ordered} <= ${beforeNul(operand)}` : `${ordered} <= ${value(operand)}`
      case 'ieq': return nul(operand) ? dialect.never : dialect.ieq(column, () => value(operand))
      default: throw new Error(`Unknown operator '${operator}' on '${field}'`)
    }
  })
}
