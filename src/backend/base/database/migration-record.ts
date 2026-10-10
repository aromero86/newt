/** A migration as the database remembers it: applied, and when. */
export type MigrationRecord = {
  version: number
  name: string
  created_at: string
}
