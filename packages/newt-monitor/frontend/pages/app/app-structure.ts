import type { GraphEdge, GraphNode } from '@newt-kit/react-ui/graph'
import type { ApplicationDescription, ContextDescription, ModuleDescription, SubscriptionDescription } from '../../api/structure'

/**
 * Reading an application's description: where each part is, and who reacts to what.
 * Ids are describeApplication's: `boards/card`, `boards/card.create`, `boards/card.created`.
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

/** What a graph of the monitor draws: @newt-kit/react-ui's `Graph` nodes and edges. */
export type StructureGraph = { nodes: GraphNode[], edges: GraphEdge[] }

/** Its contexts, and which uses which. */
export function contextsGraph(appId: string, description: ApplicationDescription): StructureGraph {
  return {
    nodes: description.contexts.map(context => ({ id: context.name, label: context.name, href: contextHref(appId, context.name) })),
    edges: description.contexts.flatMap(context => context.uses.map(used => ({ from: context.name, to: used }))),
  }
}

/**
 * What each module uses: the modules its deps are, those whose events it takes as a
 * dep, and, if asked, those whose events one of its use cases handles (dashed). One
 * edge per pair, solid if any of its reasons is.
 */
function usesOf(description: ApplicationDescription, withReactions: boolean): GraphEdge[] {
  const edges = new Map<string, GraphEdge>()
  const add = (from: string, to: string | null, dashed: boolean) => {
    if (to === null || from === to) return
    const key = `${from}>${to}`
    const known = edges.get(key)
    if (!known || (known.dashed && !dashed)) edges.set(key, { from, to, ...(dashed ? { dashed } : {}) })
  }
  for (const module of description.contexts.flatMap(context => context.modules)) {
    for (const dep of module.deps) if (dep.kind !== 'port') add(module.id, dep.target, false)
  }
  if (withReactions) {
    for (const reaction of reactionsOf(description)) {
      if (reaction.handlerModule) add(reaction.handlerModule.id, moduleOfEvent(description, reaction.event)?.id ?? null, true)
    }
  }
  return [...edges.values()]
}

/** A module as a node: its name, its page, and its context as its group when that is not the one shown. */
function moduleNode(appId: string, moduleId: string, home: string, emphasis = false): GraphNode {
  const [context, name] = moduleId.split('/') as [string, string]
  return { id: moduleId, label: name, href: moduleHref(appId, moduleId), ...(context !== home ? { group: context } : {}), ...(emphasis ? { emphasis } : {}) }
}

/**
 * What a context has to do with the others: in the middle, in its box, those of its
 * modules that use another context or are used by one; on the left, each context they
 * use, as one box; on the right, each context that uses them. Which module of the other
 * context it is shows on each module's neighbourhood: a context's whole web is too much
 * for one screen.
 */
export function contextModulesGraph(appId: string, description: ApplicationDescription, context: string, withReactions: boolean): StructureGraph {
  const contextOf = (moduleId: string) => moduleId.split('/')[0]!
  const across = usesOf(description, withReactions).filter(edge => (contextOf(edge.from) === context) !== (contextOf(edge.to) === context))
  // Each module of another context stands for its context: one edge per module and context, solid if any is.
  const edges = new Map<string, GraphEdge>()
  for (const edge of across) {
    const from = contextOf(edge.from) === context ? edge.from : contextOf(edge.from)
    const to = contextOf(edge.to) === context ? edge.to : contextOf(edge.to)
    const key = `${from}>${to}`
    const known = edges.get(key)
    if (!known || (known.dashed && !edge.dashed)) edges.set(key, { from, to, ...(edge.dashed ? { dashed: true } : {}) })
  }
  const all = [...edges.values()]
  const left = [...new Set(all.filter(edge => edge.from.includes('/')).map(edge => edge.to))]
  const right = [...new Set(all.filter(edge => edge.to.includes('/')).map(edge => edge.from))]
  const middle = [...new Set(all.flatMap(edge => [edge.from, edge.to]).filter(id => id.includes('/')))]
  const contextNode = (name: string, column: number): GraphNode => ({ id: name, label: name, href: contextHref(appId, name), column })
  return {
    nodes: [
      ...left.map(name => contextNode(name, 0)),
      ...middle.map(id => ({ ...moduleNode(appId, id, context), group: context, column: 1 })),
      // A context both used and using (a cycle, which @newt-kit/eslint refuses) stays on the left.
      ...right.filter(name => !left.includes(name)).map(name => contextNode(name, 2)),
    ],
    edges: all,
  }
}

/** A module, what it uses on its left and what uses it on its right: one step, nothing further. */
export function moduleNeighbourhood(appId: string, description: ApplicationDescription, moduleId: string, withReactions: boolean): StructureGraph {
  const home = moduleId.split('/')[0]!
  const edges = usesOf(description, withReactions).filter(edge => edge.from === moduleId || edge.to === moduleId)
  const ids = new Set([moduleId, ...edges.flatMap(edge => [edge.from, edge.to])])
  return { nodes: [...ids].map(id => moduleNode(appId, id, home, id === moduleId)), edges }
}
