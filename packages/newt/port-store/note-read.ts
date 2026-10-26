import { saveReads } from './save-reads'

/**
 * Tells the save in progress, if any, that `table` read rows in it: every table of an
 * adapter calls it as it finds and counts, so a save that guards nothing and reads
 * rows breaks the guard rule on every store, SQLite too.
 */
export function noteRead(table: string): void {
  const save = saveReads.find()
  if (save && !save.guarded) save.tables.add(table)
}
