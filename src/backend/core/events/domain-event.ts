export type DomainEvent<T = unknown> = {
  name: string
  payload: T
  occurredAt: string
}
