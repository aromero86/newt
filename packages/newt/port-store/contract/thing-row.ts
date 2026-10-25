/** The row of the table every adapter makes for the suite: `name` is unique among the rows not deleted. */
export type ThingRow = {
  id: string
  workspaceId: string
  name: string
  archived: boolean
  rank: number
  note: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
}
