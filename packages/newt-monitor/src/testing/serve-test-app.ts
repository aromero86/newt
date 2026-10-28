import { eventsOf, Module, now, type DomainEvent, type DomainEventClass } from 'newt/core'
import { serveMonitor } from 'newt/monitor'
import type { Job, QueueDepth } from 'newt/port-outbox'
import type { Store } from 'newt/port-store'
import { Base, MemoryTraces, type Trace, type TraceSpan } from 'newt/runtime'

/** The key a test's application shares with the monitor. */
export const TEST_APP_KEY = 'the test application\'s key, long enough'

/** A module of a test's application: its use cases, and the events it tells. */
export type TestModuleShape = { useCases?: string[], events?: string[] }

/** An event class named `<module>.<event>`. */
function eventClass(name: string): DomainEventClass<{ id: string }> {
  return class implements DomainEvent<{ id: string }> {
    static readonly eventName = name
    readonly name = name
    readonly occurredAt = now().toISOString()
    constructor(readonly payload: { id: string }) {}
  }
}

/** A test context's outbox as its queues say it: how full each is, and its jobs (the dead ones, to list). */
type TestOutbox = { depths: QueueDepth[], jobs: Job[] }

/** An outbox that answers only what the monitor endpoint reads of one: its depth, its queues, its dead jobs. */
function testOutbox(outbox: TestOutbox) {
  return {
    depth: async () => outbox.depths,
    queues: async () => [],
    list: async (query: { status?: string, limit?: number } = {}) => outbox.jobs.filter(job => !query.status || job.status === query.status).slice(0, query.limit),
  }
}

/** A module built from its shape: it registers its use cases as `@UseCase` would, and keeps its events. */
class TestModule extends Module {
  readonly events

  constructor(base: Base, name: string, shape: TestModuleShape) {
    super(name, base.invocations)
    for (const useCase of shape.useCases ?? []) base.invocations.registry.useCase(this, useCase)
    this.events = eventsOf(base.bus, Object.fromEntries((shape.events ?? []).map(event => [event, eventClass(`${name}.${event}`)])))
  }
}

/**
 * A newt application for a test, serving its monitor endpoint on a free port with
 * `TEST_APP_KEY`: contexts made of modules by their shape, which a test adds and
 * removes as a deployment would, and the endpoint describes as they are now.
 */
export function serveTestApp(name = 'shop') {
  const contexts: Base[] = []
  const outboxes = new Map<string, TestOutbox>()
  // Its own: the monitor's requests, in the same process, are no trace of this application.
  // Kept two minutes back: what a test keeps is in a closed minute, the monitor's to collect at once.
  const traces = new MemoryTraces({ keepMinutes: 60 * 24 * 30, clock: { now: () => new Date(Date.now() - 2 * 60_000) } })
  let server = serveMonitor(contexts, { name, port: 0, key: TEST_APP_KEY, traces })
  const port = server.port!
  return {
    url: server.url.origin,
    key: TEST_APP_KEY,
    /** A context, with its modules by name. */
    add(context: string, modules: Record<string, TestModuleShape>) {
      const outbox: TestOutbox = { depths: [], jobs: [] }
      outboxes.set(context, outbox)
      const base = new Base({ name: context, store: { outbox: testOutbox(outbox) } as unknown as Store })
      for (const [module, shape] of Object.entries(modules)) new TestModule(base, module, shape)
      // Counted from the start, as an application's contexts are once its endpoint serves.
      base.metrics.enable()
      contexts.push(base)
    },
    /** An event told in a context, counted as the application counts it: at a time, by an actor, in scopes. */
    tell(context: string, event: string, told: { at: Date, actor?: string | null, scopes?: Record<string, string>, times?: number }) {
      const base = contexts.find(each => each.name === context)!
      for (let time = 0; time < (told.times ?? 1); time++) {
        base.metrics.count({ context, event, at: told.at, actor: told.actor ?? null, scopes: told.scopes ?? {} })
      }
    },
    /** A use case's call in a context, timed as the application times it: at a time, how long, by an actor, in scopes. */
    call(context: string, useCase: string, called: { at: Date, ms: number, retries?: number, actor?: string | null, scopes?: Record<string, string>, times?: number, outcome?: { kind: 'error' | 'failure', code: string } }) {
      const base = contexts.find(each => each.name === context)!
      for (let time = 0; time < (called.times ?? 1); time++) {
        base.metrics.time({ context, useCase, at: called.at, ms: called.ms, retries: called.retries ?? 0, actor: called.actor ?? null, scopes: called.scopes ?? {}, outcome: called.outcome ?? null })
      }
    },
    /** A job's step in one of a context's queues, counted as the application counts it. */
    flow(context: string, queue: string, step: { at: Date, kind: 'published' | 'delivered' | 'redelivered' | 'dead', waitMs?: number, times?: number }) {
      const base = contexts.find(each => each.name === context)!
      for (let time = 0; time < (step.times ?? 1); time++) base.metrics.flow({ context, queue, kind: step.kind, at: step.at, waitMs: step.waitMs })
    },
    /** How full a context's queues are now, and its dead jobs, as its outbox would say. */
    queues(context: string, depths: QueueDepth[], dead: Job[] = []) {
      const outbox = outboxes.get(context)!
      outbox.depths = depths
      outbox.jobs = dead
    },
    /**
     * A trace the application kept, as its root and the calls in it: a request unless a
     * job is given. Each call a use case of a context, inside the root, one after another.
     */
    trace(kept: { id?: string, at: Date, name?: string, ms?: number, outcome?: Trace['outcome'], retried?: boolean, forced?: string, told?: Trace['told'], job?: Trace['job'], calls?: { context: string, useCase: string, ms: number, outcome?: Trace['outcome'] }[] }): string {
      const id = kept.id ?? Bun.randomUUIDv7()
      const ms = kept.ms ?? 10
      const kind = kept.job ? 'job' : 'http'
      const span = (fields: Partial<TraceSpan> & Pick<TraceSpan, 'id' | 'kind' | 'name'>): TraceSpan => ({ parentId: null, context: null, startMs: 0, ms, outcome: null, attributes: {}, failure: null, ...fields })
      const calls = (kept.calls ?? []).map((call, index) => span({ id: String(index + 2), parentId: '1', kind: 'use-case', name: call.useCase, context: call.context, ms: call.ms, outcome: call.outcome ?? null }))
      traces.record({
        id, kind, name: kept.name ?? (kept.job ? kept.job.queue : 'POST /api/test'), startedAt: kept.at.toISOString(), ms,
        outcome: kept.outcome ?? null, retried: kept.retried ?? false, actor: null, scopes: {},
        useCases: [...new Set(calls.map(call => call.name))], told: kept.told ?? [], job: kept.job ?? null,
        spans: [span({ id: '1', kind, name: kept.name ?? 'POST /api/test', outcome: kept.outcome ?? null }), ...calls], dropped: 0, forced: kept.forced ?? null,
      })
      return id
    },
    /** A context taken away. */
    remove(context: string) {
      contexts.splice(contexts.findIndex(base => base.name === context), 1)
    },
    stop: () => server.stop(true),
    /** Served again, on the same port, after `stop`: the application back after a deployment. */
    start() {
      server = serveMonitor(contexts, { name, port, key: TEST_APP_KEY, traces })
    },
  }
}

export type TestApp = ReturnType<typeof serveTestApp>
