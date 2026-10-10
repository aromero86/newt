export type UnitOfWork = {
  readonly events: Array<() => void>
  opened: boolean
}
