import { findCurrentActor, systemClock, type EventBus, type EventPublisher } from '../core'
import { activeScopes, Invocations, traceTold } from '../core/internal'
import type { Store } from '../port-store'
import type { BaseOptions } from './base-options'
import { InMemoryEventBus } from './events/in-memory-event-bus'
import { withId } from './events/with-id'
import { JobQueue } from './jobs/job-queue'
import type { Metrics } from './metrics/metrics'
import { MemoryMetrics } from './metrics/memory-metrics'
import { applicationMetrics } from './metrics/set-metrics'
import { Schedules } from './schedules/schedules'
import { tracedStore } from './traces/traced-store'

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
  /** Where it counts its events for whoever monitors it (`serveMonitor` starts it). */
  readonly metrics: Metrics

  constructor(options: BaseOptions<S>) {
    const clock = options.clock ?? systemClock
    this.name = options.name
    // Each read and write of its tables, a step of the trace in progress, if any.
    this.store = tracedStore(options.store, options.name)
    this.metrics = options.metrics ?? applicationMetrics.value ?? new MemoryMetrics()
    this.invocations = new Invocations(options.tracer, { context: options.name }, options.writeRule, clock, options.guardRule)
    // Every call of its use cases, timed as it ends, in the scopes and by the actor it ran with.
    // Only its modules' use cases: the framework's own invocations (`job.claim`, `schedule.tick`) are no one's.
    this.invocations.onTimed = ({ useCase, ms, retries, outcome }) => {
      if (!this.invocations.registry.isUseCase(useCase)) return
      this.metrics.time({ context: this.name, useCase, ms, retries, outcome, scopes: activeScopes(), actor: findCurrentActor()?.userId ?? null, at: clock.now() })
    }
    const memory = new InMemoryEventBus()
    const { registry } = this.invocations
    this.bus = {
      // Whoever publishes on the bus gets what a repository gets: the outbox, and the commit.
      publish: event => this.publisher.publish(event),
      subscribe: (pattern, handler, subscription) => {
        const unsubscribe = subscription?.mode === 'handler'
          ? this.jobs.register(subscription.name, pattern, handler, subscription.attempts, subscription.when)
          : memory.subscribe(pattern, handler)
        const forget = registry.subscription(subscription?.mode === 'handler'
          ? { event: pattern, strategy: 'handler', queue: subscription.name, attempts: subscription.attempts ?? null, filtered: subscription.when !== undefined }
          : { event: pattern, strategy: 'fire-and-forget', queue: null, attempts: null, filtered: null })
        return () => {
          forget()
          unsubscribe()
        }
      },
    }
    this.publisher = {
      publish: async event => {
        const told = withId(event)
        // Who told it and in which scopes, as it is told: counted once it is saved.
        const counted = { context: this.name, event: told.name, scopes: activeScopes(), actor: findCurrentActor()?.userId ?? null, at: clock.now() }
        const queues = await this.jobs.enqueue(told)
        traceTold(told)
        this.store.afterCommit(() => {
          this.metrics.count(counted)
          for (const queue of queues) this.metrics.flow({ context: this.name, queue, kind: 'published', at: counted.at })
          memory.publish(told)
          this.jobs.wake()
        })
      },
    }
    this.schedules = new Schedules(this.store, this.bus, this.publisher, this.invocations, clock)
    this.jobs = new JobQueue(this.store.outbox, this.invocations, options.jobs, clock, this.schedules)
    // Each job as it is taken and closed, in its queue's flow: a broker's numbers.
    this.jobs.onFlow = ({ queue, kind, waitMs }) => this.metrics.flow({ context: this.name, queue, kind, waitMs, at: clock.now() })
  }

  /** Closes its store, and its metrics: what they had not added yet is added before. */
  async close(): Promise<void> {
    await this.metrics.close()
    await this.store.close()
  }
}
