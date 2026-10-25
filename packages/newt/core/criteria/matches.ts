import { compare } from './compare'
import type { Condition } from './condition'
import type { Criteria } from './criteria'
import type { CriteriaNode } from './criteria-node'
import { criteriaTree } from './criteria-tree'
import type { Operator } from './operator'

/**
 * Whether a row meets the criteria: for stores that check rows one by one. It
 * answers what SQL would: a comparison with `null` holds for nothing, and `ieq`
 * ignores the case of A to Z only, as SQL's `lower()` does.
 */
export function matches<Row>(row: Row, criteria: Criteria<Row> = {}): boolean {
  return holds(row as Record<string, unknown>, criteriaTree(criteria))
}

function holds(row: Record<string, unknown>, node: CriteriaNode): boolean {
  switch (node.kind) {
    case 'all': return node.of.every(each => holds(row, each))
    case 'any': return node.of.some(each => holds(row, each))
    case 'field': return passes(row[node.field] ?? null, node.condition)
  }
}

function passes(value: unknown, condition: Condition<unknown>): boolean {
  return Object.entries(condition).every(([operator, operand]) => {
    const comparable = value !== null && operand !== null
    switch (operator as Operator) {
      case 'eq': return value === operand
      case 'ne': return value !== operand
      case 'in': return (operand as unknown[]).includes(value)
      case 'gt': return comparable && compare(value, operand) > 0
      case 'gte': return comparable && compare(value, operand) >= 0
      case 'lt': return comparable && compare(value, operand) < 0
      case 'lte': return comparable && compare(value, operand) <= 0
      case 'ieq': return typeof value === 'string' && typeof operand === 'string' && lower(value) === lower(operand)
    }
  })
}

function lower(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase())
}
