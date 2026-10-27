import { ConcurrencyConflict, DomainEventEmitter, type Clock, type DomainEvent, type DomainEventClass, type EventBus, type EventPublisher, type Invocations } from '../../core'
import type { Store, Table } from '../../port-store'
import { Cron } from './cron'
import type { ScheduleTick } from './schedule-tick'

/** The event a schedule tells, named after it: when it was due, told by the context's clock. */
function tickOf(name: string, clock: Clock): DomainEventClass<ScheduleTick> {
  return class implements DomainEvent<ScheduleTick> {
    static readonly eventName = name
    readonly name = name
    readonly occurredAt = clock.now().toISOString()
    constructor(readonly payload: ScheduleTick) {}
  }
}

/** `<module>.<name>`, as an event is named: `report.nightly`. */
const NAME = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/

/** How long it sleeps at most between two looks: a clock that moved, or a timer late, is seen within it. */
const LOOK_EVERY_MS = 60_000

/** How many times a tick is tried again when another process's transaction got in the way. */
const RETRIES = 3

/** The last tick each schedule fired, by its name: the store's own `schedule_tick` table. */
type TickRow = { id: string, dueAt: string, version: number }

type Schedule = { name: string, cron: Cron, event: DomainEventClass<ScheduleTick>, firedAt?: string }

/**
 * A context's schedules: each one an event its modules subscribe to as to any other,
 * told each time a cron expression says it is due (in UTC).
 *
 * ```ts
 * this.nightly = base.schedules.define('report.nightly', '0 3 * * *')
 * // elsewhere, as for any event:
 * deps.report.nightly.subscribe(tick => reports.send(tick.dueAt), { strategy: 'handler', queue: 'report.send.on.report.nightly' })
 * ```
 *
 * A `handler` subscription is a job of the outbox, tried again until it succeeds; a
 * `fire-and-forget` one runs in memory. Each tick is told once, however many
 * processes run the context: the first to record it in the store (with the jobs of
 * its handlers, in one transaction) tells it, and the others see it told. Ticks
 * missed while no process ran are not told one by one: only the last of them, once.
 * The first time a schedule runs it tells nothing of before: it waits for its next tick.
 *
 * It starts and stops with the context's jobs.
 */
export class Schedules {

  private readonly schedules = new Map<string, Schedule>()
  private ticks: Table<TickRow> | undefined
  private loop: Promise<void> | null = null
  private running = false
  private signal: (() => void) | null = null

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly publisher: EventPublisher,
    private readonly invocations: Invocations,
    private readonly clock: Clock,
  ) {}

  /** A schedule, due when `cron` says: the event its modules subscribe to, named `name`. */
  define(name: string, cron: string): DomainEventEmitter<ScheduleTick> {
    if (!NAME.test(name)) throw new Error(`A schedule is named as an event, '<module>.<name>': '${name}' is not`)
    if (this.schedules.has(name)) throw new Error(`A schedule named '${name}' is defined already`)
    const parsed = Cron.parse(cron)
    parsed.next(this.clock.now())
    const event = tickOf(name, this.clock)
    this.schedules.set(name, { name, cron: parsed, event })
    this.invocations.registry.schedule(name, parsed.expression)
    return new DomainEventEmitter(this.bus, event)
  }

  /** Starts telling its schedules as they are due. */
  start(): void {
    if (this.loop) return
    this.running = true
    this.loop = this.work()
  }

  /** Stops, once the tick in progress, if any, is told. */
  async stop(): Promise<void> {
    this.running = false
    this.signal?.()
    await this.loop
    this.loop = null
  }

  /**
   * Tells every schedule due by now that this process has not seen told yet: what it
   * does on its own as each one is due. A test that moved the clock calls it.
   */
  async tick(): Promise<void> {
    for (const schedule of this.schedules.values()) {
      const dueAt = schedule.cron.latest(this.clock.now()).toISOString()
      if (schedule.firedAt !== undefined && schedule.firedAt >= dueAt) continue
      for (let attempt = 0; ; attempt++) {
        try {
          await this.invocations.run('schedule.tick', () => this.fire(schedule, dueAt))
          break
        } catch (error) {
          // Another process wrote its tick at the same time: read again, to see if it told it.
          if (!(error instanceof ConcurrencyConflict) || attempt === RETRIES) throw error
        }
      }
      schedule.firedAt = dueAt
    }
  }

  /** Records the tick due at `dueAt` and tells it, in one transaction, unless it was told already. */
  private fire(schedule: Schedule, dueAt: string): Promise<void> {
    const ticks = this.ticks ??= this.store.table<TickRow>('schedule_tick')
    return this.store.transaction(async () => {
      const [last] = await ticks.find({ id: schedule.name })
      // Seen for the first time: nothing before now is its.
      if (!last) return ticks.insert({ id: schedule.name, dueAt })
      if (last.dueAt >= dueAt) return
      await ticks.update(schedule.name, last.version, { dueAt })
      await this.publisher.publish(new schedule.event({ dueAt }))
    })
  }

  private async work(): Promise<void> {
    while (this.running) {
      try {
        await this.tick()
      } catch (error) {
        console.error('[Schedules] telling what is due failed, it tries again at its next look:', error)
      }
      if (this.running) await this.pause()
    }
  }

  /** Until the next tick of any schedule, or a minute at most. */
  private pause(): Promise<void> {
    const now = this.clock.now()
    const next = Math.min(LOOK_EVERY_MS, ...[...this.schedules.values()].map(schedule => schedule.cron.next(now).getTime() - now.getTime()))
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        this.signal = null
        resolve()
      }
      const timer = setTimeout(done, Math.max(next, 0))
      this.signal = done
    })
  }
}
