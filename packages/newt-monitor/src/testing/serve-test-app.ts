import { eventsOf, Module, now, type DomainEvent, type DomainEventClass } from 'newt/core'
import { serveMonitor } from 'newt/monitor'
import type { Store } from 'newt/port-store'
import { Base } from 'newt/runtime'

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
  let server = serveMonitor(contexts, { name, port: 0, key: TEST_APP_KEY })
  const port = server.port!
  return {
    url: server.url.origin,
    key: TEST_APP_KEY,
    /** A context, with its modules by name. */
    add(context: string, modules: Record<string, TestModuleShape>) {
      const base = new Base({ name: context, store: { outbox: {} } as unknown as Store })
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
    /** A context taken away. */
    remove(context: string) {
      contexts.splice(contexts.findIndex(base => base.name === context), 1)
    },
    stop: () => server.stop(true),
    /** Served again, on the same port, after `stop`: the application back after a deployment. */
    start() {
      server = serveMonitor(contexts, { name, port, key: TEST_APP_KEY })
    },
  }
}

export type TestApp = ReturnType<typeof serveTestApp>
