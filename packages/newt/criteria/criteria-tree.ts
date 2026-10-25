import type { Condition } from './condition'
import type { Criteria } from './criteria'
import type { CriteriaNode } from './criteria-node'
import { isCondition } from './is-condition'

/**
 * Criteria as a tree, for a store to translate. A field, or an operator, left
 * `undefined` is no condition, and is left out; an `all` with nothing in it holds for
 * every row, an `any` with nothing in it for none.
 */
export function criteriaTree<Row>(criteria: Criteria<Row> = {}): CriteriaNode {
  const of: CriteriaNode[] = []
  for (const [field, criterion] of Object.entries(criteria)) {
    if (criterion === undefined) continue
    if (field === 'and') of.push({ kind: 'all', of: (criterion as Criteria<Row>[]).map(each => criteriaTree(each)) })
    else if (field === 'or') of.push({ kind: 'any', of: (criterion as Criteria<Row>[]).map(each => criteriaTree(each)) })
    else {
      const condition: Condition<unknown> = isCondition(criterion)
        ? Object.fromEntries(Object.entries(criterion).filter(([, operand]) => operand !== undefined))
        : { eq: criterion }
      if (Object.keys(condition).length > 0) of.push({ kind: 'field', field, condition })
    }
  }
  return of.length === 1 ? of[0]! : { kind: 'all', of }
}
