import { DomainEventEmitter, Module } from '../../core'
import type { RegisteredModule, Registry } from '../../core/internal'
import type { Base } from '../base'
import type { BoundedContext } from '../bounded-context'
import type { ApplicationDescription, ContextDescription, ModuleDependency, ModuleDescription } from './application-description'

/** How deep it looks into an object of deps for modules and events (`auth: { token, user }`). */
const DEPTH = 2

/**
 * The application as it describes itself, from what each of its contexts registered
 * while it was opened: every module built, every `@UseCase` of one, every schedule
 * defined and every subscription made. Read while it runs, nothing from the code.
 *
 * A module's events are the emitters it keeps (`this.events = eventsOf(…)`,
 * `this.nightly = base.schedules.define(…)`), those it was given in its deps left out.
 * Its deps are those its constructor passed to `Module`; one passed none has none.
 * A dep's events are told by a module of the contexts given, or of none known.
 */
export function describeApplication(contexts: (Base | BoundedContext)[]): ApplicationDescription {
  const registries = contexts.map(each => ('base' in each ? each.base : each).invocations.registry)
  const owners = new Map<DomainEventEmitter<any>, string>()
  for (const registry of registries) {
    for (const module of registry.registeredModules) {
      for (const emitter of emittersOf(module)) owners.set(emitter, moduleId(registry.context, module.instance.name))
    }
  }
  return { version: 1, contexts: registries.map(registry => describeContext(registry, owners)) }
}

function describeContext(registry: Registry, owners: Map<DomainEventEmitter<any>, string>): ContextDescription {
  const { context } = registry
  const modules = registry.registeredModules.map(module => describeModule(registry, module, owners))
  const uses = new Set(modules.flatMap(module => module.deps.map(dep => dep.target?.split('/')[0])).filter(each => each !== undefined && each !== context))
  return {
    name: context,
    uses: [...uses] as string[],
    modules,
    subscriptions: registry.subscriptions.map(({ event, strategy, queue, attempts, filtered }) => ({
      event: eventId(context, event),
      strategy,
      queue,
      handler: queue === null ? null : queue.slice(0, queue.indexOf('.on.')),
      attempts,
      filtered,
    })),
  }
}

function describeModule(registry: Registry, module: RegisteredModule, owners: Map<DomainEventEmitter<any>, string>): ModuleDescription {
  const { context } = registry
  const { name } = module.instance
  return {
    id: moduleId(context, name),
    context,
    name,
    className: module.className,
    useCases: [...module.useCases].map(([useCase, options]) => ({
      id: `${context}/${name}.${useCase}`,
      name: `${name}.${useCase}`,
      writesTo: options.writesTo ?? [],
      retryOnConflict: options.retryOnConflict ?? true,
    })),
    events: emittersOf(module).map(emitter => {
      const cron = registry.cron(emitter.name)
      return { id: eventId(context, emitter.name), name: emitter.name, schedule: cron === undefined ? null : { cron } }
    }),
    deps: module.deps ? dependencies(module.deps, owners) : [],
  }
}

/**
 * The emitters a module keeps, each once: on a field of its own, or in an object of
 * them (`events`). Those reachable from its deps are another module's.
 */
function emittersOf(module: RegisteredModule): DomainEventEmitter<any>[] {
  const given = new Set<unknown>()
  if (module.deps) collect(module.deps, DEPTH, value => given.add(value))
  const found = new Set<DomainEventEmitter<any>>()
  for (const value of Object.values(module.instance as Record<string, unknown>)) {
    if (value === module.deps) continue
    if (value instanceof DomainEventEmitter) found.add(value)
    else if (isPlain(value)) for (const inner of Object.values(value)) if (inner instanceof DomainEventEmitter) found.add(inner)
  }
  return [...found].filter(emitter => !given.has(emitter))
}

/** Every value under `value`, `depth` objects deep. */
function collect(value: object, depth: number, add: (value: unknown) => void): void {
  for (const inner of Object.values(value)) {
    add(inner)
    if (depth > 1 && isPlain(inner)) collect(inner, depth - 1, add)
  }
}

/**
 * A module's deps, key by key: a module, an emitter or an object of emitters of one
 * module, an object that holds modules or events (looked into, its keys joined:
 * `auth.token`), or else a port.
 */
function dependencies(deps: object, owners: Map<DomainEventEmitter<any>, string>): ModuleDependency[] {
  const found: ModuleDependency[] = []
  const walk = (name: string, value: unknown, depth: number): void => {
    if (value === undefined || value === null || (typeof value !== 'object' && typeof value !== 'function')) return
    if (value instanceof Module) {
      found.push({ name, kind: 'module', target: moduleId(value.invocations.registry.context, value.name) })
      return
    }
    if (value instanceof DomainEventEmitter) {
      found.push({ name, kind: 'events', target: owners.get(value) ?? null, events: [value.name] })
      return
    }
    const inner = isPlain(value) ? Object.values(value) : []
    const emitters = inner.filter(each => each instanceof DomainEventEmitter)
    const targets = new Set(emitters.map(emitter => owners.get(emitter) ?? null))
    if (emitters.length > 0 && emitters.length === inner.length && targets.size === 1) {
      found.push({ name, kind: 'events', target: [...targets][0]!, events: emitters.map(emitter => emitter.name) })
    } else if (depth > 1 && inner.some(each => each instanceof Module || each instanceof DomainEventEmitter || isPlain(each))) {
      for (const [key, each] of Object.entries(value)) walk(`${name}.${key}`, each, depth - 1)
    } else {
      found.push({ name, kind: 'port', target: null })
    }
  }
  for (const [name, value] of Object.entries(deps)) walk(name, value, DEPTH)
  return found
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function moduleId(context: string, module: string): string {
  return `${context}/${module}`
}

function eventId(context: string, event: string): string {
  return `${context}/${event}`
}
