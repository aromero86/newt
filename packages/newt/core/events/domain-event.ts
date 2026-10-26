import type { Json } from './json'

/** Something that happened, told after the save that made it happen: its payload is `Json`. */
export type DomainEvent<T extends Json = Json> = {
  name: string
  payload: T
  occurredAt: string
}
