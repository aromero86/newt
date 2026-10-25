export type SqlTableOptions<Row> = {
  /** The column of a field, when it is not the field in snake case (`workspaceId` → `workspace_id`). */
  columns?: Partial<Record<keyof Row & string, string>>
}
