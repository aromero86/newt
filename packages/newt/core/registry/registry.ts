import type { UseCaseOptions } from '../use-case/use-case-options'

/** A module as it told the registry of itself: what it is, what it was given, its use cases. */
export type RegisteredModule = {
  instance: { readonly name: string }
  className: string
  /** What its `initialize` gave it, as its constructor passed it on (`super('card', base.invocations, deps)`). */
  deps: object | undefined
  /** Its use cases, in the order its class declares them, each with what its `@UseCase` says. */
  useCases: Map<string, UseCaseOptions>
}

/** A subscription to one of the context's events, as the bus was given it. */
export type RegisteredSubscription = {
  /** The event's name, or the pattern a `fire-and-forget` handler listens to. */
  event: string
  strategy: 'handler' | 'fire-and-forget'
  /** `handler`s only, as is `attempts` (null: the queue's default). */
  queue: string | null
  attempts: number | null
  /** `handler`s only: whether it says `when`, so some events write no job (a `fire-and-forget` one checks it in memory, unseen). */
  filtered: boolean | null
}

/**
 * What a context knows of itself while it runs: each module registers as it is
 * built, each `@UseCase` as its module's instance is, each schedule as it is defined
 * and each subscription as it is made. Nothing is read from the code: what is here is
 * what runs. `describeApplication` (@newt-kit/newt/runtime) turns it into a description.
 */
export class Registry {

  private readonly modules = new Map<string, RegisteredModule>()
  private readonly cronOf = new Map<string, string>()
  private readonly subscribed = new Set<RegisteredSubscription>()

  constructor(
    /** The context's name: `''` for invocations of no context (a test's). */
    readonly context: string,
  ) {}

  /** A module, built: another one of its name built later in the context takes its place (a test that builds it again). */
  module(instance: { readonly name: string }, deps?: object): void {
    this.modules.set(instance.name, { instance, className: instance.constructor.name, deps, useCases: new Map() })
  }

  /** One of its module's use cases, as the instance is built (after the module, which `super` registered). */
  useCase(instance: { readonly name: string }, name: string, options: UseCaseOptions = {}): void {
    let module = this.modules.get(instance.name)
    if (module?.instance !== instance) {
      this.module(instance)
      module = this.modules.get(instance.name)!
    }
    module.useCases.set(name, options)
  }

  /** Whether a name is one of its modules' use cases: `card.create` is, the framework's own `job.claim` is not. */
  isUseCase(name: string): boolean {
    const dot = name.indexOf('.')
    return this.modules.get(name.slice(0, dot))?.useCases.has(name.slice(dot + 1)) ?? false
  }

  /** A schedule, by the name of the event it tells. */
  schedule(name: string, cron: string): void {
    this.cronOf.set(name, cron)
  }

  /** A subscription; what it answers forgets it again, as unsubscribing does. */
  subscription(subscription: RegisteredSubscription): () => void {
    this.subscribed.add(subscription)
    return () => this.subscribed.delete(subscription)
  }

  /** Its modules, in the order they were built. */
  get registeredModules(): RegisteredModule[] {
    return [...this.modules.values()]
  }

  /** The cron expression of a schedule of the context; none for an event that is no schedule. */
  cron(event: string): string | undefined {
    return this.cronOf.get(event)
  }

  get subscriptions(): RegisteredSubscription[] {
    return [...this.subscribed]
  }
}
