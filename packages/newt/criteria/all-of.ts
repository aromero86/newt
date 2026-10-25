import type { Criteria } from './criteria'

/** Both at once: what `a` asks, and what `b` asks. */
export function allOf<Row>(a: Criteria<Row>, b: Criteria<Row>): Criteria<Row> {
  return { and: [a, b] } as Criteria<Row>
}
