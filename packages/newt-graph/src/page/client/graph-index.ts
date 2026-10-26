import type { Edge, EventNode, Graph, Location, SubscriptionNode } from '../../model'

export type ItemKind = 'context' | 'module' | 'useCase' | 'event' | 'route'

/** Anything drawn: a context, a module, a use case, an event (or schedule) or a route. */
export type Item = Location & {
  id: string
  kind: ItemKind
  /** What it is called on the graph: `create` inside the module `card`. */
  label: string
  /** What it is called anywhere: `boards/card.create`. */
  title: string
  context: string
  /** The module it is in (itself, for a module); null for a context, and a context's own routes. */
  module: string | null
  parent: string | null
  test: boolean
  schedule: string | null
}

/** Which filter an edge answers to. */
export type EdgeGroup = 'calls' | 'events' | 'schedules' | 'writesTo' | 'routes' | 'depends'

/** An edge between items, as fine as the model has it; `event` is a use case to a handler of an event it tells, the event left out. */
export type FineEdge = Location & {
  id: string
  kind: Edge['kind'] | 'event'
  group: EdgeGroup
  from: string
  to: string
  async: boolean
  /** The event between (for `event`), the subscription (for `triggers`), or the port (for `calls`). */
  via: string | null
  subscription: SubscriptionNode | null
  test: boolean
}

export const GROUPS: EdgeGroup[] = ['calls', 'events', 'schedules', 'writesTo', 'routes', 'depends']

export class GraphIndex {
  readonly items = new Map<string, Item>()
  readonly children = new Map<string, string[]>()
  /** With events as nodes: emits and triggers. */
  readonly withEvents: FineEdge[] = []
  /** Without them: a use case straight to each handler of each event it tells; schedules keep theirs. */
  readonly withoutEvents: FineEdge[] = []
  readonly subscriptions = new Map<string, SubscriptionNode>()
  readonly eventsById = new Map<string, EventNode>()
  private readonly out = new Map<string, FineEdge[]>()
  private readonly in = new Map<string, FineEdge[]>()

  constructor(readonly graph: Graph) {
    const testModules = new Set(graph.modules.filter(each => each.test).map(each => each.id))
    for (const context of graph.contexts) {
      this.add({ id: context.id, kind: 'context', label: context.name, title: context.name, context: context.id, module: null, parent: null, test: false, schedule: null, file: context.file, line: context.line })
    }
    for (const module of graph.modules) {
      this.add({ id: module.id, kind: 'module', label: module.name, title: module.id, context: module.context, module: module.id, parent: module.context, test: module.test, schedule: null, file: module.file, line: module.line })
    }
    for (const useCase of graph.useCases) {
      const module = this.items.get(useCase.module)!
      this.add({ id: useCase.id, kind: 'useCase', label: useCase.name, title: `${useCase.context}/${module.label}.${useCase.name}`, context: useCase.context, module: useCase.module, parent: useCase.module, test: testModules.has(useCase.module), schedule: null, file: useCase.file, line: useCase.line })
    }
    for (const event of graph.events) {
      this.eventsById.set(event.id, event)
      this.add({ id: event.id, kind: 'event', label: event.name, title: event.id, context: event.context, module: event.module, parent: event.module, test: testModules.has(event.module), schedule: event.schedule?.cron ?? null, file: event.file, line: event.line })
    }
    for (const route of graph.routes) {
      this.add({ id: route.id, kind: 'route', label: `${route.method} ${shortPath(route.path)}`, title: `${route.context} ${route.method} ${route.path}`, context: route.context, module: route.module, parent: route.module ?? route.context, test: false, schedule: null, file: route.file, line: route.line })
    }
    for (const subscription of graph.subscriptions) this.subscriptions.set(subscription.id, subscription)

    for (const edge of graph.edges) {
      const subscription = edge.kind === 'triggers' && edge.via ? this.subscriptions.get(edge.via) ?? null : null
      const fromSchedule = edge.kind === 'triggers' && this.items.get(edge.from)?.schedule !== null
      const group: EdgeGroup = edge.kind === 'emits' || edge.kind === 'triggers' ? (fromSchedule ? 'schedules' : 'events') : edge.kind
      const fine: FineEdge = { id: edge.id, kind: edge.kind, group, from: edge.from, to: edge.to, async: edge.async, via: edge.via, subscription, test: subscription?.test ?? false, file: edge.file, line: edge.line }
      this.withEvents.push(fine)
      if (edge.kind !== 'emits' && (edge.kind !== 'triggers' || fromSchedule)) this.withoutEvents.push(fine)
    }
    // A use case to each handler of each event it tells.
    for (const emit of this.withEvents.filter(each => each.kind === 'emits')) {
      for (const trigger of this.withEvents.filter(each => each.kind === 'triggers' && each.from === emit.to)) {
        this.withoutEvents.push({
          ...trigger,
          id: `event:${emit.from}->${trigger.to}@${emit.to}`,
          kind: 'event',
          group: 'events',
          from: emit.from,
          via: emit.to,
        })
      }
    }
    for (const edge of this.withEvents) {
      this.push(this.out, edge.from, edge)
      this.push(this.in, edge.to, edge)
    }
  }

  private add(item: Item): void {
    this.items.set(item.id, item)
    if (item.parent) this.push(this.children, item.parent, item.id)
  }

  private push<V>(map: Map<string, V[]>, key: string, value: V): void {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  outOf(id: string): FineEdge[] {
    return this.out.get(id) ?? []
  }

  into(id: string): FineEdge[] {
    return this.in.get(id) ?? []
  }

  /** Itself and every item inside it. */
  descendants(id: string): string[] {
    const found = [id]
    for (const child of this.children.get(id) ?? []) found.push(...this.descendants(child))
    return found
  }

  /** Its context, its module, itself: the outermost first. */
  ancestors(id: string): string[] {
    const chain: string[] = []
    for (let current = this.items.get(id); current; current = current.parent ? this.items.get(current.parent) : undefined) chain.unshift(current.id)
    return chain
  }

  /** The use cases a run of an item starts at: itself, a route's, a module's or a context's every one. */
  starts(id: string): string[] {
    const item = this.items.get(id)
    if (!item) return []
    if (item.kind === 'useCase' || item.kind === 'event' || item.kind === 'route') return [id]
    return this.descendants(id).filter(each => this.items.get(each)?.kind === 'useCase')
  }
}

/** A route's path without what every route of a workspace shares. */
export function shortPath(path: string): string {
  return path.replace(/^\/api/, '').replace(/^\/workspaces\/:workspaceId(?=\/)/, '/…') || '/'
}

/** One step of a chain: an item reached, by which edge, in which wave (0 = the request; each worker hop one more), how deep in it. */
export type ChainNode = {
  item: string
  edge: FineEdge | null
  wave: number
  depth: number
  /** Shown already, higher up: not followed again. */
  repeat: boolean
  children: ChainNode[]
  /** Its frame in the animation. */
  frame: number
}

export type Chain = {
  roots: ChainNode[]
  direction: 'down' | 'up'
  /** The items and edges in it. */
  items: Set<string>
  edges: Set<string>
  /** The animation: what lights up together, in order. */
  frames: { wave: number, edges: FineEdge[], nodes: string[] }[]
}

/**
 * Everything a use case sets going: the use cases it calls (now, in the same request),
 * the events it tells, the handlers they set going (later, each one a wave more), and
 * so on. `up` is the other way: whatever can set it going.
 */
export function chainOf(index: GraphIndex, start: string, direction: 'down' | 'up'): Chain {
  const seen = new Set<string>()
  const items = new Set<string>()
  const edges = new Set<string>()
  const build = (item: string, edge: FineEdge | null, wave: number, depth: number): ChainNode => {
    items.add(item)
    if (edge) edges.add(edge.id)
    const node: ChainNode = { item, edge, wave, depth, repeat: seen.has(item), children: [], frame: 0 }
    if (node.repeat) return node
    seen.add(item)
    const kind = index.items.get(item)?.kind
    if (direction === 'down') {
      const outgoing = index.outOf(item)
      // Now: the use cases it calls, then where it writes, then what it tells.
      for (const each of outgoing.filter(e => e.kind === 'calls' || e.kind === 'routes')) node.children.push(build(each.to, each, wave, depth + 1))
      for (const each of outgoing.filter(e => e.kind === 'writesTo')) {
        items.add(each.to)
        edges.add(each.id)
        node.children.push({ item: each.to, edge: each, wave, depth: depth + 1, repeat: false, children: [], frame: 0 })
      }
      for (const each of outgoing.filter(e => e.kind === 'emits')) node.children.push(build(each.to, each, wave, depth + 1))
      // Later: each handler of an event, by a worker (or in memory, after the commit).
      if (kind === 'event') for (const each of outgoing.filter(e => e.kind === 'triggers')) node.children.push(build(each.to, each, wave + 1, 0))
    } else {
      const incoming = index.into(item)
      for (const each of incoming.filter(e => e.kind === 'calls' || e.kind === 'routes')) node.children.push(build(each.from, each, wave, depth + 1))
      for (const each of incoming.filter(e => e.kind === 'triggers')) node.children.push(build(each.from, each, wave + 1, 0))
      if (kind === 'event') for (const each of incoming.filter(e => e.kind === 'emits')) node.children.push(build(each.from, each, wave, depth + 1))
    }
    return node
  }
  const roots = index.starts(start).map(each => build(each, null, 0, 0))

  // Frames: by wave, then by depth within it. Up, the farthest cause plays first.
  const all: ChainNode[] = []
  const walk = (node: ChainNode) => {
    all.push(node)
    node.children.forEach(walk)
  }
  roots.forEach(walk)
  const key = (node: ChainNode) => node.wave * 1000 + node.depth
  const keys = [...new Set(all.map(key))].sort((a, b) => direction === 'down' ? a - b : b - a)
  const frames = keys.map(each => {
    const nodes = all.filter(node => key(node) === each)
    for (const node of nodes) node.frame = keys.indexOf(each)
    return { wave: nodes[0]!.wave, edges: nodes.flatMap(node => node.edge ? [node.edge] : []), nodes: nodes.map(node => node.item) }
  })
  return { roots, direction, items, edges, frames }
}
