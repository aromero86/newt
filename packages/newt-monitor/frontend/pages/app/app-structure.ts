import type { ApplicationDescription, ContextDescription, ModuleDescription, SubscriptionDescription } from '../../api/structure'

/**
 * Reading an application's description: where each part is, and who reacts to what.
 * Ids are newt-graph's: `boards/card`, `boards/card.create`, `boards/card.created`.
 */

/** The address of a module's page in an application. */
export function moduleHref(appId: string, moduleId: string): string {
  const [context, module] = moduleId.split('/')
  return `/apps/${appId}/contexts/${context}/modules/${module}`
}

/** A module a use case writes to, as `writesTo` names it: a module of its own context, by name. */
export function writtenModuleId(context: string, target: string): string {
  return target.includes('/') ? target : `${context}/${target}`
}

export function contextHref(appId: string, context: string): string {
  return `/apps/${appId}/contexts/${context}`
}

export function findContext(description: ApplicationDescription, name: string): ContextDescription | undefined {
  return description.contexts.find(context => context.name === name)
}

export function findModule(description: ApplicationDescription, context: string, name: string): ModuleDescription | undefined {
  return findContext(description, context)?.modules.find(module => module.name === name)
}

/** The module that tells an event, by the event's id. */
export function moduleOfEvent(description: ApplicationDescription, eventId: string): ModuleDescription | undefined {
  return description.contexts.flatMap(context => context.modules).find(module => module.events.some(event => event.id === eventId))
}

/**
 * A subscription, with where it is: the context whose events it hears, and the module
 * whose use case handles them. A handler is named by its use case alone (`workspace.purge`),
 * and two contexts may have a module of the same name, so it is found by its use case.
 */
export type Reaction = SubscriptionDescription & {
  /** The context whose bus it listens to. */
  context: string
  /** The module of its handler; null for a fire-and-forget one, or a handler no module declares. */
  handlerModule: ModuleDescription | null
}

export function reactionsOf(description: ApplicationDescription): Reaction[] {
  const modules = description.contexts.flatMap(context => context.modules)
  return description.contexts.flatMap(context => context.subscriptions.map(subscription => ({
    ...subscription,
    context: context.name,
    handlerModule: subscription.handler === null
      ? null
      : modules.find(module => module.useCases.some(useCase => useCase.name === subscription.handler)) ?? null,
  })))
}

/** Whether a text matches a filter: every word of it, anywhere, whatever the case. */
export function matches(text: string, filter: string): boolean {
  const haystack = text.toLowerCase()
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word))
}

/** A part of an application: a context, a module, a use case or an event, as the catalog names them. */
export type Part = { kind: 'context' | 'module' | 'useCase' | 'event', id: string, name: string, context: string, module: string | null }

/** Every part a description has, contexts first, each one's modules after it. */
export function partsOf(description: ApplicationDescription): Part[] {
  return description.contexts.flatMap(context => [
    { kind: 'context' as const, id: context.name, name: context.name, context: context.name, module: null },
    ...context.modules.flatMap(module => [
      { kind: 'module' as const, id: module.id, name: module.name, context: context.name, module: module.name },
      ...module.useCases.map(useCase => ({ kind: 'useCase' as const, id: useCase.id, name: useCase.name, context: context.name, module: module.name })),
      ...module.events.map(event => ({ kind: 'event' as const, id: event.id, name: event.name, context: context.name, module: module.name })),
    ]),
  ])
}

/** What a version added to the one before it, and what it took away: everything is added to none. */
export function differenceOf(before: ApplicationDescription | null, after: ApplicationDescription): { added: Part[], removed: Part[] } {
  const was = before ? partsOf(before) : []
  const is = partsOf(after)
  const had = new Set(was.map(part => `${part.kind}:${part.id}`))
  const has = new Set(is.map(part => `${part.kind}:${part.id}`))
  return {
    added: is.filter(part => !had.has(`${part.kind}:${part.id}`)),
    removed: was.filter(part => !has.has(`${part.kind}:${part.id}`)),
  }
}
