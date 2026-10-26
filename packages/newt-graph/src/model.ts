/**
 * The graph of a newt application, as `newt-graph --json` prints it and the page draws
 * it. The schema is versioned: a field is only ever added, and `version` goes up when one
 * changes meaning.
 *
 * Every id is stable between runs of the same code: a context's is its name, a module's
 * `<context>/<module>`, a use case's `<context>/<module>.<useCase>`, an event's
 * `<context>/<event name>` (the context of the module that tells it), and so on.
 * Every `file` is relative to `app.base`, every `line` 1-based.
 */
export type Graph = {
  version: 1
  app: AppInfo
  contexts: ContextNode[]
  modules: ModuleNode[]
  useCases: UseCaseNode[]
  events: EventNode[]
  subscriptions: SubscriptionNode[]
  routes: RouteNode[]
  edges: Edge[]
  /** What the analysis could not settle: a callee it could not follow, an event of no module. */
  warnings: Warning[]
}

export type AppInfo = {
  name: string
  /** Absolute: what every `file` is relative to (and `vscode://file/<base>/<file>:<line>` opens). */
  base: string
  /** The folder analysed, relative to `base`. */
  root: string
  tsconfig: string
  generatedAt: string
  /** Whether test files and `testing/` helpers were analysed too (their nodes say `test: true`). */
  tests: boolean
}

export type Location = { file: string, line: number }

export type ContextNode = Location & {
  id: string
  name: string
  /** The contexts it may use, as newt-eslint's `context-boundaries` declares them; null when none is declared. */
  uses: string[] | null
}

export type ModuleNode = Location & {
  id: string
  context: string
  /** Its name as its use cases are named: `card` of `card.create`. */
  name: string
  className: string
  /** Where it is initialized in its context (`Card_Module.initialize(base, …)`). */
  initializedAt: Location
  /** A class of a test, or of a `testing/` helper (a fake). */
  test: boolean
  deps: ModuleDep[]
}

export type ModuleDep = Location & {
  /** The key in its deps (`column`, `auth.tenant`). */
  name: string
  /** A module of the application, or a port (an object in the module's own words, or another context's events). */
  kind: 'module' | 'port'
  /** The module it is, or the module behind the port when the analysis can tell; null otherwise. */
  target: string | null
}

export type UseCaseNode = Location & {
  id: string
  module: string
  context: string
  name: string
  /** `@UseCase({ writesTo })`: the modules it may write to outside a worker. */
  writesTo: string[]
  retryOnConflict: boolean
}

export type EventNode = Location & {
  id: string
  /** `card.created` */
  name: string
  module: string
  context: string
  /** The event class (`Card_Created`), or the schedule's emitter. */
  className: string | null
  /** A schedule: an event the context tells as the cron expression says. */
  schedule: { cron: string } | null
}

export type SubscriptionNode = Location & {
  id: string
  event: string
  /** The module that reacts (the one whose workers registered it). */
  module: string
  context: string
  /** The use cases its callback calls; empty for a fire-and-forget that calls none (a log line). */
  handlers: string[]
  strategy: 'handler' | 'fire-and-forget'
  /** `handler`s only: `<module>.<useCase>.on.<event>`. */
  queue: string | null
  attempts: number | null
  /** It says `when`: some of the events write no job. */
  filtered: boolean
  /** The context whose outbox keeps its jobs and whose worker runs them: the emitter's. */
  runsIn: string
  test: boolean
}

export type RouteNode = Location & {
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** As the router serves it, prefixes included (`/api/workspaces/:workspaceId/cards/:cardId`); `?` where one could not be read. */
  path: string
  /** The module whose routes file registers it; null for a context's own routes. */
  module: string | null
  context: string
  /** The use cases it calls, its group's middleware's included. */
  useCases: string[]
}

export type EdgeKind =
  /** A use case calls another, now, in the same request (`this.deps.column.get(…)`). */
  | 'calls'
  /** A use case tells an event (an entity of its module tracks it, or the bus publishes it). */
  | 'emits'
  /** An event sets a use case going, through a subscription: a job (handler) or in memory (fire-and-forget). */
  | 'triggers'
  /** `@UseCase({ writesTo })`: a write to another module outside a worker, said where it is seen. */
  | 'writesTo'
  /** A route calls a use case. */
  | 'routes'
  /** A module is given another (or a port of it) when it is initialized. */
  | 'depends'

export type Edge = Location & {
  id: string
  kind: EdgeKind
  from: string
  to: string
  /** `triggers`: async, run later by a worker (handler) or after the commit (fire-and-forget). */
  async: boolean
  /** `triggers`: the subscription. `calls`: the port member it went through (`Workspaces.isMember`). */
  via: string | null
  /** `triggers`: handler or fire-and-forget. */
  strategy?: 'handler' | 'fire-and-forget'
}

export type Warning = Location & { message: string }
