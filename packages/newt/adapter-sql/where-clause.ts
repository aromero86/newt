import type { Condition, CriteriaNode } from '../criteria'
import type { SqlDialect } from './sql-dialect'

/** How criteria meet a table: its columns, and its values as they go in. */
export type WhereContext = {
  dialect: SqlDialect
  column(field: string): string
  value(field: string, operand: unknown): unknown
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
  const value = (operand: unknown) => {
    params.push(context.value(field, operand))
    return dialect.param(params.length)
  }
  return Object.entries(condition).map(([operator, operand]) => {
    switch (operator) {
      case 'eq': return operand === null ? `${column} IS NULL` : `${column} = ${value(operand)}`
      case 'ne': return operand === null ? `${column} IS NOT NULL` : dialect.distinct(column, value(operand))
      case 'in': {
        // SQL's IN never matches null: a null in the list asks for IS NULL beside it.
        const list = (operand as unknown[]).filter(each => each !== null)
        const among = list.length === 0 ? dialect.never : `${column} IN (${list.map(value).join(', ')})`
        return list.length === (operand as unknown[]).length ? among : `(${among} OR ${column} IS NULL)`
      }
      case 'gt': return `${column} > ${value(operand)}`
      case 'gte': return `${column} >= ${value(operand)}`
      case 'lt': return `${column} < ${value(operand)}`
      case 'lte': return `${column} <= ${value(operand)}`
      case 'ieq': return dialect.ieq(column, () => value(operand))
      default: throw new Error(`Unknown operator '${operator}' on '${field}'`)
    }
  })
}
