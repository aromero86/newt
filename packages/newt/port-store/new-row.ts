import type { StoredRow } from './stored-row'

/** A row about to be inserted: the table gives it its first version. */
export type NewRow<Row extends StoredRow> = Omit<Row, 'version'>
