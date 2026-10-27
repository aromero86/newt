import type { Criteria } from '../../core/criteria/criteria'
import { isCondition } from '../../core/criteria/is-condition'
import type { FindOptions } from '../../port-store/find-options'

/**
 * A query as its trace says it, by its shape and never its values: the fields it
 * filters by and how, its order, its limit. `{workspaceId, status in, or(dueAt lt, dueAt null)} order position limit 50`
 */
export function queryShape<Row>(criteria: Criteria<Row> | undefined, options?: FindOptions<Row>): string {
  const parts = [criteriaShape((criteria ?? {}) as Criteria<object>)]
  if (options?.orderBy?.length) parts.push(`order ${options.orderBy.map(each => `${each.field}${each.direction === 'desc' ? ' desc' : ''}`).join(', ')}`)
  if (options?.limit !== undefined) parts.push(`limit ${options.limit}`)
  return parts.join(' ')
}

function criteriaShape(criteria: Criteria<object>): string {
  const fields: string[] = []
  for (const [field, value] of Object.entries(criteria)) {
    if (value === undefined) continue
    if (field === 'and' || field === 'or') fields.push(`${field}(${(value as Criteria<object>[]).map(criteriaShape).join(', ')})`)
    else if (value === null) fields.push(`${field} null`)
    else if (isCondition(value)) {
      const operators = Object.entries(value).filter(([, operand]) => operand !== undefined).map(([operator]) => operator)
      fields.push(operators.length ? `${field} ${operators.join(' ')}` : field)
    } else fields.push(field)
  }
  return `{${fields.join(', ')}}`
}
