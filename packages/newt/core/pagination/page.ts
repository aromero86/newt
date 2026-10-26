/** One page of a list, whether more follow, and how many there are in all. */
export type Page<T> = {
  items: T[]
  hasMore: boolean
  total: number
  /**
   * Where the next page starts, when not after the id of its last item: a page made
   * from another (`mapPage`) starts after the last item of that one.
   */
  nextCursor?: string
}
