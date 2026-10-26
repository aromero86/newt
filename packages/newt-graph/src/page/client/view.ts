import type { EdgeGroup, FineEdge, GraphIndex, Item } from './graph-index'

export type Granularity = 'contexts' | 'modules' | 'useCases' | 'events'

export const GRANULARITIES: { id: Granularity, label: string, key: string }[] = [
  { id: 'contexts', label: 'Contexts', key: '1' },
  { id: 'modules', label: 'Modules', key: '2' },
  { id: 'useCases', label: 'Use cases', key: '3' },
  { id: 'events', label: '+ Events', key: '4' },
]

export type ViewState = {
  granularity: Granularity
  /** A context or module opened (true) or closed (false) in place, against what the granularity says. */
  overrides: Map<string, boolean>
  hiddenContexts: Set<string>
  groups: Set<EdgeGroup>
  showTests: boolean
  /** Only these items (and what holds them) are drawn; null for all. */
  allowed: Set<string> | null
  /** Draw which contexts may use which (newt-eslint's `uses`) and flag what crosses them otherwise. */
  boundaries: boolean
}

export type DisplayNode = { id: string, item: Item, parent: string | null, collapsed: boolean, inside: number }

export type DisplayEdge = {
  id: string
  from: string
  to: string
  group: EdgeGroup | 'uses'
  fine: FineEdge[]
  async: boolean
  /** It crosses from a context to one it does not say it uses. */
  violation: boolean
}

export type View = {
  nodes: DisplayNode[]
  edges: DisplayEdge[]
  /** Which drawn edge each fine edge is part of. */
  edgeOf: Map<string, string>
  /** Which drawn node stands for each item (itself, or the closed module or context that holds it). */
  rep: (id: string) => string | null
}

export function isExpanded(state: ViewState, item: Item): boolean {
  const override = state.overrides.get(item.id)
  if (override !== undefined) return override
  if (item.kind === 'context') return state.granularity !== 'contexts'
  if (item.kind === 'module') return state.granularity === 'useCases' || state.granularity === 'events'
  return false
}

export function computeView(index: GraphIndex, state: ViewState): View {
  const { items } = index
  const repMemo = new Map<string, string | null>()

  const shownLeaf = (item: Item): boolean => {
    if (item.kind === 'event') {
      if (item.schedule !== null) return state.groups.has('schedules')
      return state.granularity === 'events'
    }
    if (item.kind === 'route') return state.groups.has('routes')
    return true
  }

  const rep = (id: string): string | null => {
    if (repMemo.has(id)) return repMemo.get(id)!
    const item = items.get(id)
    let found: string | null = null
    if (item && !state.hiddenContexts.has(item.context) && (state.showTests || !item.test)) {
      found = item.id
      for (const ancestor of index.ancestors(id)) {
        if (ancestor === id) break
        const holder = items.get(ancestor)!
        if (!isExpanded(state, holder)) {
          found = ancestor
          break
        }
      }
      if (found === item.id && !shownLeaf(item)) found = null
    }
    repMemo.set(id, found)
    return found
  }

  // Every item drawn as itself.
  let drawn = [...items.values()].filter(item => rep(item.id) === item.id)
  if (state.allowed) {
    const keep = new Set<string>()
    for (const id of state.allowed) {
      const shown = rep(id)
      if (!shown) continue
      for (const ancestor of index.ancestors(shown)) keep.add(ancestor)
    }
    drawn = drawn.filter(item => keep.has(item.id))
  }
  const drawnIds = new Set(drawn.map(item => item.id))
  const nodes: DisplayNode[] = drawn.map(item => {
    const collapsed = (item.kind === 'context' || item.kind === 'module') && !isExpanded(state, item)
    return {
      id: item.id,
      item,
      parent: item.parent && drawnIds.has(item.parent) ? item.parent : null,
      collapsed,
      inside: collapsed ? index.descendants(item.id).filter(each => items.get(each)?.kind === 'useCase').length : 0,
    }
  })

  const fine = state.granularity === 'events' ? index.withEvents : index.withoutEvents
  const edges = new Map<string, DisplayEdge>()
  const edgeOf = new Map<string, string>()
  const usesOf = new Map(index.graph.contexts.map(context => [context.id, context.uses]))
  for (const edge of fine) {
    if (!state.groups.has(edge.group) || (edge.test && !state.showTests)) continue
    const from = rep(edge.from)
    const to = rep(edge.to)
    if (!from || !to || from === to || !drawnIds.has(from) || !drawnIds.has(to)) continue
    const id = `${edge.group}|${from}|${to}`
    let shown = edges.get(id)
    if (!shown) {
      const fromContext = items.get(from)!.context
      const toContext = items.get(to)!.context
      // Who uses whom: a caller its callee, a module what it is given, a handler the context of the event.
      const [user, used] = edge.group === 'events' || edge.group === 'schedules' ? [toContext, fromContext] : [fromContext, toContext]
      const uses = usesOf.get(user)
      shown = { id, from, to, group: edge.group, fine: [], async: edge.async, violation: user !== used && uses !== null && uses !== undefined && !uses.includes(used) }
      edges.set(id, shown)
    }
    shown.fine.push(edge)
    edgeOf.set(edge.id, id)
  }
  if (state.boundaries) {
    for (const context of index.graph.contexts) {
      for (const used of context.uses ?? []) {
        if (!drawnIds.has(context.id) || !drawnIds.has(used)) continue
        const id = `uses|${context.id}|${used}`
        edges.set(id, { id, from: context.id, to: used, group: 'uses', fine: [], async: false, violation: false })
      }
    }
  }
  return { nodes, edges: [...edges.values()], edgeOf, rep }
}
