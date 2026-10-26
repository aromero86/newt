/** Which page of a list: up to `size` items after `cursor`, the id of the last item already shown. */
export type PageRequest = {
  size?: number
  cursor?: string
}
