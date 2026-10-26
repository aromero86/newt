import type { Condition } from './condition'

/**
 * Criteria as a tree, what a store translates: every one of a group (`all`), at
 * least one (`any`), or a condition on one field.
 */
export type CriteriaNode =
  | { kind: 'all', of: CriteriaNode[] }
  | { kind: 'any', of: CriteriaNode[] }
  | { kind: 'field', field: string, condition: Condition<unknown> }
