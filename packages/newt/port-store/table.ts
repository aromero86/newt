import type { Criteria } from '../core'
import type { FindOptions } from './find-options'
import type { NewRow } from './new-row'
import type { StoredRow } from './stored-row'

/**
 * A table of rows with an id and a version, in any storage: what a repository needs
 * to find, insert, change and delete them without knowing where they are. Each write
 * joins the transaction in progress, or runs in one of its own.
 */
export interface Table<Row extends StoredRow> {
  find(criteria?: Criteria<Row>, options?: FindOptions<Row>): Promise<Row[]>
  count(criteria?: Criteria<Row>): Promise<number>
  /** Stores it with version 1; `DuplicateValue` if its id or a unique value is taken. */
  insert(row: NewRow<Row>): Promise<void>
  /** Changes a row still at `version`, one version on; `ConcurrencyConflict` otherwise. */
  update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void>
  /**
   * Changes a row whatever its version, leaving the version as it is: for what only
   * notes something happened (`lastUsedAt`), which parallel requests write without
   * colliding. Nothing when there is no such row.
   */
  patch(id: string, changes: Partial<NewRow<Row>>): Promise<void>
  /** Removes a row still at `version`; `ConcurrencyConflict` otherwise. */
  delete(id: string, version: number): Promise<void>
}
