/** A migration as it is on disk: its up and down scripts. */
export type MigrationFile = {
  version: number
  name: string
  upPath: string
  downPath: string
}
