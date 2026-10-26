import type { z } from 'zod'
import type { Criteria } from '../criteria'
import type { FilterField } from './filter-field'
import type { FilterNode } from './filter-node'

/** What `defineFilter` gives: the schema a client's filter must pass, and its criteria. */
export type Filter<Fields extends Record<string, FilterField>> = {
  /** Validates a filter: only the fields and operators declared, within the limits; a 400 otherwise. */
  readonly schema: z.ZodType<FilterNode<Fields>>
  /** The criteria a valid filter stands for, in the row's fields. */
  toCriteria<Row>(filter: FilterNode<Fields>): Criteria<Row>
}
