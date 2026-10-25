// newt/criteria: what to find, said field by field so every store understands it, and
// the filters a client may send, declared closed and turned into criteria.

// Criteria
export type { Criteria } from './criteria'
export type { Condition } from './condition'
export type { Operator } from './operator'
export { allOf } from './all-of'
export { isCondition } from './is-condition'
export type { CriteriaNode } from './criteria-node'
export { criteriaTree } from './criteria-tree'
export { matches } from './matches'
export { compare } from './compare'

// Filters a client sends
export { defineFilter, type FilterLimits } from './filter/define-filter'
export type { Filter } from './filter/filter'
export type { FilterField } from './filter/filter-field'
export type { FilterNode } from './filter/filter-node'
