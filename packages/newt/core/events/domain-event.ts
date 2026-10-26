import type { Json } from './json'

/** Something that happened, told after the save that made it happen: its payload is `Json`. */
export type DomainEvent<T extends Json = Json> = {
  /**
   * Its own id, the same for every handler of it and every run of its job: what a
   * handler that does something once per event keys on. Whoever tells it leaves it
   * out: the publisher gives it one.
   */
  id?: string
  name: string
  payload: T
  occurredAt: string
}
