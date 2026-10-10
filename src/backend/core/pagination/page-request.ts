/**
 * Which page of a list: up to `size` items after `cursor`, the id of the last item
 * of the previous page. Ids are v7, so they sort by time and the cursor is stable
 * while items are added.
 */
export type PageRequest = {
  size: number
  cursor?: string
}
