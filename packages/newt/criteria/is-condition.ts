import type { Condition } from './condition'
import type { Operator } from './operator'

const OPERATORS = new Set<string>(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'ieq'] satisfies Operator[])

/** Whether a criterion is a condition, not a value to equal. */
export function isCondition(value: unknown): value is Condition<unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every(key => OPERATORS.has(key))
}
