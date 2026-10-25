/** One page of a list, whether more follow, and how many there are in all. */
export type Page<T> = {
  items: T[]
  hasMore: boolean
  total: number
}
