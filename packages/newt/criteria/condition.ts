/** What a field must pass: every operator in it. */
export type Condition<V> = {
  eq?: V
  /** Different, `null` included: `{ ne: null }` is "has one". */
  ne?: V
  in?: readonly V[]
  gt?: V
  gte?: V
  lt?: V
  lte?: V
  /** Equal, whatever the case of A to Z: `Acme` and `acme` (as SQL's `lower()`, which leaves `Ñ` as it is). */
  ieq?: V
}
