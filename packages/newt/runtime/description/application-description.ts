/**
 * An application as it describes itself while it runs (`describeApplication`): its
 * contexts, the modules of each, their use cases, the events they tell and what they
 * depend on. A field is only ever added; `version` goes up when one changes meaning.
 *
 * Ids are newt-graph's: a module's `<context>/<module>`, a use case's
 * `<context>/<module>.<useCase>`, an event's `<context>/<event name>`.
 */
export type ApplicationDescription = {
  version: 1
  contexts: ContextDescription[]
}

export type ContextDescription = {
  name: string
  /** The contexts its modules depend on, as their deps say. */
  uses: string[]
  modules: ModuleDescription[]
  /** The subscriptions to its events: a `handler`'s jobs are in its outbox, and its worker runs them. */
  subscriptions: SubscriptionDescription[]
}

export type ModuleDescription = {
  id: string
  context: string
  /** Its name as its use cases are named: `card` of `card.create`. */
  name: string
  className: string
  useCases: UseCaseDescription[]
  /** The events it tells, its schedules among them. */
  events: EventDescription[]
  deps: ModuleDependency[]
}

export type UseCaseDescription = {
  id: string
  /** `card.create` */
  name: string
  /** `@UseCase({ writesTo })`: the modules it may write to outside a worker. */
  writesTo: string[]
  retryOnConflict: boolean
}

export type EventDescription = {
  id: string
  /** `card.created` */
  name: string
  /** A schedule: an event the context tells as the cron expression says. */
  schedule: { cron: string } | null
}

/**
 * One of a module's deps, by its key (`column`; `auth.token` for one inside an
 * object of them): another module, events of one (`tenants: tenant.events`), or a
 * port, an object in the module's own words whose module it cannot tell.
 */
export type ModuleDependency =
  | { name: string, kind: 'module', target: string }
  /** `target` is the module that tells them, null when it is of no context described. */
  | { name: string, kind: 'events', target: string | null, events: string[] }
  | { name: string, kind: 'port', target: null }

export type SubscriptionDescription = {
  /** The event's id, or the pattern a `fire-and-forget` handler listens to. */
  event: string
  strategy: 'handler' | 'fire-and-forget'
  /** `handler`s only: `<module>.<useCase>.on.<event>`. */
  queue: string | null
  /** `handler`s only: the use case its queue names (`card.notify`). */
  handler: string | null
  /** `handler`s only: null for the queue's default. */
  attempts: number | null
  /** `handler`s only: it says `when`, so some events write no job. */
  filtered: boolean | null
}
