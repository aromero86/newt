import type { Condition } from './condition'
import type { Operator } from './operator'

const OPERATORS = new Set<string>(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'ieq'] satisfies Operator[])

/**
 * Whether a criterion is a condition, not a value to equal: a plain object whose keys
 * are all operators. `{}` is one too, with no operator in it, so no condition at all,
 * as `{ gte: undefined }` is. Criteria hold no object values to equal (see `Criteria`);
 * a `Date`, or any other object of a class, is a value.
 */
export function isCondition(value: unknown): value is Condition<unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.keys(value).every(key => OPERATORS.has(key))
}
