/** What a key did lately, as a store keeps it: the start of its window and what it took in it and in the one before. */
export type WindowCount = {
  /** When its window began, in milliseconds. */
  start: number
  count: number
  previous: number
}
