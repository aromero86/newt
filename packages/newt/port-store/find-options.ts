export type FindOptions<Row> = {
  /** By id, ascending, unless told otherwise. */
  orderBy?: { field: keyof Row & string, direction?: 'asc' | 'desc' }[]
  limit?: number
}
