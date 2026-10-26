import { systemClock, type EventBus, type EventPublisher } from '../core'
import { Invocations } from '../core/internal'
import type { Store } from '../port-store'
import type { BaseOptions } from './base-options'
import { InMemoryEventBus } from './events/in-memory-event-bus'
import { withId } from './events/with-id'
import { JobQueue } from './jobs/job-queue'
import { Schedules } from './schedules/schedules'

/**
 * The infrastructure every module of a context receives: its store, the invocations
 * of its use cases, the event bus, and the jobs of its `handler` subscriptions. The
 * context picks the store, opened and up to date, and may hand a tracer to watch it.
 *
 * An application that gives its modules more (an HTTP router, a mailer) extends it:
 * `class AppBase extends Base<SqliteStore> { readonly http = new HttpRouter() }`.
 */
export class Base<S extends Store = Store> {

  readonly name: string
  readonly store: S
  readonly invocations: Invocations
  readonly bus: EventBus
  /**
   * What repositories publish entities' events to: it writes the jobs of the event's
   * `handler` subscriptions in the transaction of the save, and runs its
   * `fireAndForget` ones once it commits.
   */
  readonly publisher: EventPublisher
  readonly jobs: JobQueue
  /** Its schedules, each an event told as a cron expression says: they start and stop with its jobs. */
  readonly schedules: Schedules

  constructor(options: BaseOptions<S>) {
    const clock = options.clock ?? systemClock
    this.name = options.name
    this.store = options.store
    this.invocations = new Invocations(options.tracer, { context: options.name }, options.writeRule, clock)
    const memory = new InMemoryEventBus()
    this.bus = {
      // Whoever publishes on the bus gets what a repository gets: the outbox, and the commit.
      publish: event => this.publisher.publish(event),
      subscribe: (pattern, handler, subscription) => subscription?.mode === 'handler'
        ? this.jobs.register(subscription.name, pattern, handler, subscription.attempts, subscription.when)
        : memory.subscribe(pattern, handler),
    }
    this.publisher = {
      publish: async event => {
        const told = withId(event)
        await this.jobs.enqueue(told)
        this.store.afterCommit(() => {
          memory.publish(told)
          this.jobs.wake()
        })
      },
    }
    this.schedules = new Schedules(this.store, this.bus, this.publisher, this.invocations, clock)
    this.jobs = new JobQueue(this.store.outbox, this.invocations, options.jobs, clock, this.schedules)
  }

  close(): Promise<void> {
    return this.store.close()
  }
}
