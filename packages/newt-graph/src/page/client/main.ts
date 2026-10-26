import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import type { Graph } from '../../model'
import { fuzzyScore } from './fuzzy'
import { chainOf, GROUPS, GraphIndex, type Chain, type ChainNode, type EdgeGroup, type FineEdge, type Item } from './graph-index'
import { colorsFor, graphStyle, PALETTES, type Theme } from './theme'
import { computeView, GRANULARITIES, isExpanded, type DisplayEdge, type Granularity, type View, type ViewState } from './view'

cytoscape.use(fcose)

const graph = JSON.parse(document.getElementById('graph')!.textContent!) as Graph
const index = new GraphIndex(graph)
const STORE = `newt-graph:${graph.app.name}`

// ------------------------------------------------------------------ what is kept between visits

type Saved = { granularity?: Granularity, hiddenContexts?: string[], groups?: EdgeGroup[], showTests?: boolean, theme?: Theme | 'auto', marks?: string[] }

function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Saved
  } catch {
    return {}
  }
}

function save(): void {
  try {
    const saved: Saved = {
      granularity: state.granularity,
      hiddenContexts: [...state.hiddenContexts],
      groups: [...state.groups],
      showTests: state.showTests,
      theme: themeChoice,
      marks: [...marks],
    }
    localStorage.setItem(STORE, JSON.stringify(saved))
  } catch {
    // A browser that keeps nothing: the page works the same, and forgets.
  }
}

const saved = loadSaved()
const state: ViewState = {
  granularity: saved.granularity ?? (graph.useCases.length > 60 ? 'modules' : 'useCases'),
  overrides: new Map(),
  hiddenContexts: new Set((saved.hiddenContexts ?? []).filter(id => index.items.has(id))),
  groups: new Set(saved.groups ?? ['calls', 'events', 'schedules', 'writesTo']),
  showTests: saved.showTests ?? false,
  allowed: null,
  boundaries: false,
}
const marks = new Set((saved.marks ?? []).filter(id => index.items.has(id)))
let themeChoice: Theme | 'auto' = saved.theme ?? 'auto'
let focusSelection = false
let depsView: { granularity: Granularity, groups: Set<EdgeGroup> } | null = null
let selected: string | null = null
let view: View

const systemDark = matchMedia('(prefers-color-scheme: dark)')
const theme = (): Theme => themeChoice === 'auto' ? (systemDark.matches ? 'dark' : 'light') : themeChoice
let colorOf = colorsFor(index, theme())

// ------------------------------------------------------------------ building the page

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    else if (key === 'className') element.className = String(value)
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value)
    else if (key in element && typeof value !== 'string') (element as unknown as Record<string, unknown>)[key] = value
    else element.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) element.append(child)
  return element
}

/** Puts these children in an element instead of its own, skipping what is not there. */
function fill(element: HTMLElement, ...children: (Node | string | null | undefined | false)[]): void {
  element.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false))
}

const app = document.getElementById('app')!
const searchInput = h('input', { type: 'search', placeholder: 'Search use cases, events, modules, routes…', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' })
const results = h('div', { className: 'results', role: 'listbox', hidden: true })
const granularityButtons = GRANULARITIES.map(each => h('button', { onClick: () => setGranularity(each.id), title: `${each.label} (${each.key})` }, each.label, h('span', {}, each.key)))
const depsButton = h('button', { onClick: () => toggleDepsView(), title: 'Modules and what they depend on, with the contexts\' boundaries (d)' }, 'Dependencies')
const themeButton = h('button', { onClick: () => cycleTheme(), title: 'Theme (t)' })
const side = h('aside', { className: 'side', 'aria-label': 'Filters' })
const panel = h('section', { className: 'panel', 'aria-label': 'Details', 'aria-live': 'polite' })
const toast = h('div', { className: 'toast', role: 'status' })
const cyContainer = h('div', { id: 'cy' })
const helpOverlay = h('div', { className: 'overlay', hidden: true, onClick: (event: Event) => { if (event.target === helpOverlay) helpOverlay.hidden = true } },
  h('div', { className: 'dialog', role: 'dialog', 'aria-label': 'Keys' },
    h('h2', {}, 'Keys'),
    h('div', { className: 'keys' },
      ...[
        ['/', 'search'], ['1 2 3 4', 'contexts, modules, use cases, + events'], ['click', 'select; double click opens or closes a context or module'],
        ['x', 'open or close the selected context or module'], ['e', 'side effects of the selection'], ['u', 'who can cause it'],
        ['space', 'play or pause'], ['→  ←', 'step forward, back'], ['r', 'replay'], ['i', 'only the chain, or everything'],
        ['m', 'mark the selection (kept in this browser)'], ['s', 'only what touches the selection'], ['d', 'dependencies view'],
        ['f', 'fit'], ['t', 'theme'], ['Esc', 'stop, close, deselect'], ['?', 'these keys'],
      ].flatMap(([key, what]) => [h('div', {}, ...key!.split(' ').map(each => h('kbd', {}, each))), h('div', {}, what)]),
    ),
    h('p', { className: 'note' }, 'Read from the code by newt-graph: what TypeScript can follow. A call through a value chosen at run time counts every module it may be.'),
  ),
)

app.append(
  h('header', { className: 'top' },
    h('div', { className: 'brand' }, graph.app.name, h('small', {}, 'newt-graph')),
    h('div', { className: 'search' }, searchInput, h('kbd', {}, '/'), results),
    h('div', { className: 'segmented', role: 'group', 'aria-label': 'Granularity' }, ...granularityButtons),
    depsButton,
    h('div', { className: 'spacer' }),
    h('div', { className: 'group' },
      h('button', { onClick: () => cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 300 }), title: 'Fit (f)' }, 'Fit'),
      themeButton,
      h('button', { onClick: () => { helpOverlay.hidden = false }, title: 'Keys (?)', 'aria-label': 'Keys' }, '?'),
    ),
  ),
  side,
  h('main', { className: 'canvas' }, cyContainer, h('div', { className: 'hint' }, 'Click to select, double click to open or close, ', h('kbd', {}, 'e'), ' side effects, ', h('kbd', {}, '?'), ' keys'), toast),
  panel,
)
document.body.append(helpOverlay)

const cy = cytoscape({
  container: cyContainer,
  wheelSensitivity: 0.25,
  minZoom: 0.05,
  maxZoom: 3,
  boxSelectionEnabled: false,
  style: graphStyle(PALETTES[theme()]) as cytoscape.StylesheetJson,
})

// For whoever looks from the console, or drives the page in a test.
Object.assign(window, { newtGraph: { cy, cytoscape, state, index, get view() { return view } } })

// ------------------------------------------------------------------ drawing

let first = true

function nodeLabel(item: Item, collapsed: boolean, inside: number): string {
  if (item.kind === 'context' && collapsed) return `${item.label}\n${index.graph.modules.filter(each => each.context === item.id && (state.showTests || !each.test)).length} modules · ${inside} use cases`
  if (item.kind === 'module' && collapsed) return `${item.label}\n${inside} use cases`
  if (item.kind === 'event' && item.schedule) return `${item.label}  ${item.schedule}`
  return item.label
}

function render(options: { fit?: boolean, layout?: boolean } = {}): void {
  view = computeView(index, state)
  const before = new Map<string, cytoscape.Position>()
  cy.nodes().forEach(node => { before.set(node.id(), { ...node.position() }) })
  const wantedNodes = new Map(view.nodes.map(each => [each.id, each]))
  const wantedEdges = new Map(view.edges.map(each => [each.id, each]))
  let changed = false
  const added: string[] = []
  cy.batch(() => {
    cy.edges().forEach(edge => {
      if (!wantedEdges.has(edge.id())) {
        edge.remove()
        changed = true
      }
    })
    // Children before their parents: a removed parent takes them along.
    cy.nodes().forEach(node => {
      if (!node.inside()) return
      const wanted = wantedNodes.get(node.id())
      if (node.hasClass('pulse') || !wanted) {
        // What it held and is still drawn stays, out of it.
        node.children().filter(child => wantedNodes.has(child.id())).move({ parent: null })
        node.remove()
        changed = true
      }
    })
    for (const shown of view.nodes) {
      const colors = colorOf(shown.item)
      const label = nodeLabel(shown.item, shown.collapsed, shown.inside)
      const data = {
        id: shown.id,
        label,
        kind: shown.item.kind,
        schedule: shown.item.schedule !== null,
        stroke: colors.stroke,
        fill: colors.fill,
        soft: colors.soft,
        wave: colors.stroke,
        ...sizeOf(shown.item, label),
      }
      const existing = cy.getElementById(shown.id)
      if (existing.nonempty()) {
        existing.data(data)
        if ((existing.data('parent') ?? null) !== shown.parent) {
          existing.move({ parent: shown.parent })
          changed = true
        }
      } else {
        cy.add({ group: 'nodes', data: { ...data, parent: shown.parent ?? undefined }, position: startPosition(shown.id, before) })
        added.push(shown.id)
        changed = true
      }
      const node = cy.getElementById(shown.id)
      node.toggleClass('collapsed', shown.collapsed)
      node.toggleClass('test', shown.item.test)
      node.toggleClass('marked', marks.has(shown.id))
    }
    for (const shown of view.edges) {
      const count = shown.group === 'uses' ? 0 : shown.fine.length
      const data = {
        id: shown.id,
        source: shown.from,
        target: shown.to,
        group: shown.group,
        label: count > 1 ? String(count) : '',
        width: shown.group === 'uses' ? 6 : 1.3 + Math.log2(Math.max(1, count)) * 0.9,
        wave: PALETTES[theme()].accent,
      }
      const existing = cy.getElementById(shown.id)
      if (existing.nonempty()) existing.data({ label: data.label, width: data.width })
      else {
        cy.add({ group: 'edges', data })
        changed = true
      }
      cy.getElementById(shown.id).toggleClass('violation', shown.violation)
    }
  })
  // Many new nodes (another granularity): laid out afresh; a few (one module opened): moved gently from where they are.
  if ((changed || first) && options.layout !== false) layout(options.fit ?? true, first || added.length > Math.max(8, cy.nodes().length * 0.3))
  first = false
  if (selected && cy.getElementById(selected).nonempty()) cy.getElementById(selected).select()
  applyHighlights()
}

/** A node's box, from its label: Cytoscape no longer sizes one by its label itself. */
function sizeOf(item: Item, label: string): { w: number, h: number } {
  const font = item.kind === 'context' ? 16 : item.kind === 'module' ? 12 : item.kind === 'route' ? 9 : 11
  const lines = label.split('\n')
  const longest = Math.max(...lines.map(line => line.length))
  const pad = item.kind === 'context' ? 36 : item.kind === 'module' ? 22 : item.kind === 'route' ? 28 : 14
  return { w: Math.round(longest * font * 0.6 + pad), h: Math.round(lines.length * font * 1.3 + pad * 0.7) }
}

/** Where a new node starts: where the module or context it opened from was, or amid what it closes over. */
function startPosition(id: string, before: Map<string, cytoscape.Position>): cytoscape.Position {
  const inside = index.descendants(id).slice(1).map(each => before.get(each)).filter(each => each !== undefined)
  if (inside.length) return { x: inside.reduce((sum, each) => sum + each.x, 0) / inside.length, y: inside.reduce((sum, each) => sum + each.y, 0) / inside.length }
  for (const ancestor of index.ancestors(id).reverse()) {
    const at = before.get(ancestor)
    if (at) return { x: at.x + (Math.random() - 0.5) * 40, y: at.y + (Math.random() - 0.5) * 40 }
  }
  const extent = cy.extent()
  return { x: (extent.x1 + extent.x2) / 2 + (Math.random() - 0.5) * 200, y: (extent.y1 + extent.y2) / 2 + (Math.random() - 0.5) * 200 }
}

let running: cytoscape.Layouts | null = null

/** How far an edge reaches: 0 within a module, 1 across modules, 2 across contexts. */
function span(edge: cytoscape.EdgeSingular): 0 | 1 | 2 {
  const from = index.items.get(edge.source().id())
  const to = index.items.get(edge.target().id())
  if (!from || !to || from.context !== to.context) return 2
  return from.module !== null && from.module === to.module ? 0 : 1
}

function layout(fit: boolean, afresh: boolean): void {
  running?.stop()
  const options = {
    name: 'fcose',
    quality: afresh ? 'proof' : 'default',
    randomize: afresh,
    animate: !first,
    animationDuration: 600,
    fit,
    padding: 40,
    nodeDimensionsIncludeLabels: true,
    uniformNodeDimensions: false,
    packComponents: true,
    nodeRepulsion: () => 6000,
    // Edges across modules, and more across contexts, pull weakly and long: otherwise
    // the many of them drag modules into each other and the boxes overlap.
    idealEdgeLength: (edge: cytoscape.EdgeSingular) => [60, 180, 340][span(edge)],
    edgeElasticity: (edge: cytoscape.EdgeSingular) => [0.45, 0.05, 0.01][span(edge)],
    nestingFactor: 0.1,
    gravity: 0.25,
    gravityCompound: 1.0,
    gravityRangeCompound: 1.5,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 16,
    tilingPaddingHorizontal: 16,
  }
  running = cy.elements().not('.pulse').layout(options as unknown as cytoscape.LayoutOptions)
  // A few nodes fitted would fill the screen: no closer than a comfortable reading size.
  if (fit) running.one('layoutstop', () => { if (cy.zoom() > 1.4) cy.zoom({ level: 1.4, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }) })
  running.run()
}

// ------------------------------------------------------------------ highlights: selection, focus, the chain

function applyHighlights(): void {
  cy.batch(() => {
    cy.elements().removeClass('faded touching')
    if (run) {
      paintRun()
      return
    }
    if (!selected) return
    const node = cy.getElementById(selected)
    if (node.empty()) return
    const keep = node.closedNeighborhood().union(node.descendants()).union(node.descendants().connectedEdges())
    const withParents = keep.union(keep.nodes().ancestors())
    cy.elements().not(withParents).addClass('faded')
    withParents.addClass('touching')
  })
}

function touching(id: string): Set<string> {
  const ids = new Set(index.descendants(id))
  const fine = state.granularity === 'events' ? index.withEvents : index.withoutEvents
  const found = new Set(ids)
  for (const edge of fine) {
    if (ids.has(edge.from)) found.add(edge.to)
    if (ids.has(edge.to)) found.add(edge.from)
  }
  return found
}

function updateFocus(): void {
  if (run && run.isolate) state.allowed = run.chain.items
  else if (focusSelection && selected) state.allowed = touching(selected)
  else state.allowed = null
}

// ------------------------------------------------------------------ selecting

function select(id: string | null, options: { center?: boolean } = {}): void {
  selected = id
  cy.$(':selected').unselect()
  if (id) {
    const shown = view.rep(id)
    const node = shown ? cy.getElementById(shown) : cy.collection()
    if (node.nonempty()) {
      node.select()
      if (options.center) cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 350 })
    }
  }
  if (focusSelection) {
    updateFocus()
    render()
  } else applyHighlights()
  if (!run) showDetails()
  renderSide()
}

/** Makes an item visible: opens what holds it, shows its context, and what it needs drawn. */
function reveal(id: string): void {
  const item = index.items.get(id)
  if (!item) return
  state.hiddenContexts.delete(item.context)
  if (item.test) state.showTests = true
  for (const ancestor of index.ancestors(id)) if (ancestor !== id) state.overrides.set(ancestor, true)
  if (item.kind === 'event' && !item.schedule && state.granularity !== 'events') state.granularity = 'events'
  if (item.kind === 'event' && item.schedule) state.groups.add('schedules')
  if (item.kind === 'route') state.groups.add('routes')
  if (state.allowed && !state.allowed.has(id)) {
    focusSelection = false
    if (run) run.isolate = false
    state.allowed = null
  }
  render({ fit: false })
  select(id, { center: true })
  syncControls()
}

cy.on('tap', 'node', event => {
  const node = event.target as cytoscape.NodeSingular
  if (node.hasClass('pulse')) return
  select(node.id())
})
cy.on('tap', 'edge', event => {
  const edge = view.edges.find(each => each.id === (event.target as cytoscape.EdgeSingular).id())
  if (edge) showEdge(edge)
})
cy.on('tap', event => {
  if (event.target === cy) {
    selected = null
    if (focusSelection) {
      updateFocus()
      render()
    } else applyHighlights()
    if (!run) showDetails()
  }
})
cy.on('dbltap', 'node', event => toggleOpen((event.target as cytoscape.NodeSingular).id()))

function toggleOpen(id: string): void {
  let item = index.items.get(id)
  if (item && item.kind !== 'context' && item.kind !== 'module') item = item.parent ? index.items.get(item.parent) : undefined
  if (!item) return
  state.overrides.set(item.id, !isExpanded(state, item))
  render({ fit: false })
}

// ------------------------------------------------------------------ the side bar

function renderSide(): void {
  const contextRows = graph.contexts.map(context => {
    const item = index.items.get(context.id)!
    const colors = colorOf(item)
    const modules = graph.modules.filter(each => each.context === context.id && (state.showTests || !each.test)).length
    return h('label', { className: 'check' },
      h('input', { type: 'checkbox', checked: !state.hiddenContexts.has(context.id), onChange: (event: Event) => {
        if ((event.target as HTMLInputElement).checked) state.hiddenContexts.delete(context.id)
        else state.hiddenContexts.add(context.id)
        save()
        render()
      } }),
      h('span', { className: 'swatch', style: { borderColor: colors.stroke, background: colors.soft } }),
      h('button', { className: 'link', onClick: (event: Event) => { event.preventDefault(); reveal(context.id) } }, context.name),
      h('span', { className: 'count' }, String(modules)),
    )
  })
  const groupInfo: Record<EdgeGroup, { label: string, color: string, line: string }> = {
    calls: { label: 'Calls (now, same request)', color: 'var(--calls)', line: '' },
    events: { label: 'Events and their workers', color: 'var(--events)', line: 'dashed' },
    schedules: { label: 'Schedules', color: 'var(--schedules)', line: 'dashed' },
    writesTo: { label: 'writesTo exceptions', color: 'var(--writes)', line: '' },
    routes: { label: 'Routes', color: 'var(--routes)', line: 'dotted' },
    depends: { label: 'Declared deps', color: 'var(--depends)', line: 'dotted' },
  }
  const groupRows = GROUPS.map(group => h('label', { className: 'check' },
    h('input', { type: 'checkbox', checked: state.groups.has(group), onChange: (event: Event) => {
      if ((event.target as HTMLInputElement).checked) state.groups.add(group)
      else state.groups.delete(group)
      save()
      render()
    } }),
    h('span', { className: `line ${groupInfo[group].line}`, style: { borderTopColor: groupInfo[group].color } }),
    groupInfo[group].label,
  ))
  const option = (label: string, checked: boolean, onChange: (checked: boolean) => void, title?: string, disabled = false) => h('label', { className: 'check', title },
    h('input', { type: 'checkbox', checked, disabled, onChange: (event: Event) => onChange((event.target as HTMLInputElement).checked) }), label)
  const markRows = [...marks].map(id => {
    const item = index.items.get(id)
    return item ? h('li', {}, h('button', { className: 'link', onClick: () => reveal(id) }, item.title), h('button', { title: 'Unmark', 'aria-label': `Unmark ${item.title}`, onClick: () => toggleMark(id) }, '×')) : null
  })
  fill(side,
    h('h2', {}, 'Contexts'),
    ...contextRows,
    h('h2', {}, 'Edges'),
    ...groupRows,
    h('h2', {}, 'Show'),
    option('Tests and fakes', state.showTests, checked => { state.showTests = checked; save(); render() },
      graph.app.tests ? undefined : 'Run newt-graph with --tests to read them', !graph.app.tests),
    option('Only what touches the selection', focusSelection, checked => { focusSelection = checked; updateFocus(); render() }, 's'),
    option('Context boundaries (uses)', state.boundaries, checked => { state.boundaries = checked; render() },
      graph.contexts.some(each => each.uses) ? 'Which contexts each may use, as newt-eslint declares them' : 'No newt-eslint contexts found', !graph.contexts.some(each => each.uses)),
    h('h2', {}, `Marked (${marks.size})`),
    marks.size ? h('ul', { className: 'marks' }, ...markRows) : h('p', { className: 'note' }, 'Select something and press ', h('kbd', {}, 'm'), ' to keep it here.'),
    marks.size ? h('div', { className: 'actions' },
      h('button', { onClick: () => { state.allowed = new Set([...marks].flatMap(each => [...touching(each)])); focusSelection = false; render() } }, 'Only these'),
      h('button', { onClick: () => { marks.clear(); save(); render(); renderSide() } }, 'Clear'),
    ) : null,
    h('h2', {}, 'Legend'),
    h('div', { className: 'legend' },
      h('span', { className: 'shape box' }), 'context ⊃ module ⊃ use case',
      h('span', { className: 'shape diamond' }), 'event',
      h('span', { className: 'shape clock' }), 'schedule',
      h('span', { className: 'shape tag' }), 'route',
      h('span', { className: 'line', style: { borderTopColor: 'var(--writes)', borderTopWidth: '3px' } }), 'crosses a boundary (not in uses)',
    ),
    graph.warnings.length ? h('details', {}, h('summary', {}, `${graph.warnings.length} warnings`),
      h('ul', { className: 'related' }, ...graph.warnings.map(each => h('li', {}, h('a', { href: editorLink(each.file, each.line) }, `${each.file}:${each.line}`), ' ', each.message)))) : null,
    h('p', { className: 'note' }, `${graph.contexts.length} contexts · ${graph.modules.length} modules · ${graph.useCases.length} use cases · ${graph.events.length} events · ${graph.subscriptions.length} subscriptions · ${graph.routes.length} routes`),
  )
}

function syncControls(): void {
  granularityButtons.forEach((button, n) => button.setAttribute('aria-pressed', String(GRANULARITIES[n]!.id === state.granularity)))
  depsButton.setAttribute('aria-pressed', String(depsView !== null))
  themeButton.textContent = themeChoice === 'auto' ? 'Auto' : themeChoice === 'dark' ? 'Dark' : 'Light'
  renderSide()
}

function setGranularity(granularity: Granularity): void {
  state.granularity = granularity
  state.overrides.clear()
  save()
  syncControls()
  render()
}

function toggleDepsView(): void {
  if (depsView) {
    state.granularity = depsView.granularity
    state.groups = depsView.groups
    state.boundaries = false
    depsView = null
  } else {
    depsView = { granularity: state.granularity, groups: new Set(state.groups) }
    state.granularity = 'modules'
    state.groups = new Set(['calls', 'events', 'depends'])
    state.boundaries = graph.contexts.some(each => each.uses)
  }
  state.overrides.clear()
  syncControls()
  render()
  toastMessage(depsView ? 'Dependencies: solid = direct (calls), dashed = through events, dotted = declared deps, green = uses' : 'Back to the graph')
}

function cycleTheme(): void {
  themeChoice = themeChoice === 'auto' ? (systemDark.matches ? 'light' : 'dark') : themeChoice === 'dark' ? 'light' : 'dark'
  applyTheme()
  save()
}

function applyTheme(): void {
  document.documentElement.dataset.theme = theme()
  colorOf = colorsFor(index, theme())
  cy.style(graphStyle(PALETTES[theme()]) as cytoscape.StylesheetJson)
  render({ layout: false })
  syncControls()
  if (run) paintRun()
}
systemDark.addEventListener('change', () => { if (themeChoice === 'auto') applyTheme() })

function toggleMark(id: string): void {
  if (marks.has(id)) marks.delete(id)
  else marks.add(id)
  save()
  const shown = view.rep(id)
  if (shown) cy.getElementById(shown).toggleClass('marked', marks.has(shown))
  renderSide()
  toastMessage(marks.has(id) ? 'Marked' : 'Unmarked')
}

let toastTimer = 0
function toastMessage(text: string): void {
  toast.textContent = text
  toast.classList.add('shown')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('shown'), 2200)
}

// ------------------------------------------------------------------ details

const editorLink = (file: string, line: number) => `vscode://file/${`${graph.app.base}/${file}`.replace(/\/+/g, '/')}:${line}`

function where(file: string, line: number): HTMLElement {
  return h('div', { className: 'where' }, h('a', { href: editorLink(file, line), title: 'Open in VS Code' }, `${file}:${line}`))
}

function itemButton(id: string, meta?: string): HTMLElement {
  const item = index.items.get(id)
  if (!item) return h('li', {}, id)
  return h('li', {},
    h('span', { className: 'dot', style: { background: colorOf(item).stroke } }),
    h('button', { className: 'link', onClick: () => reveal(id) }, item.title),
    meta ? h('span', { className: 'meta' }, meta) : null,
  )
}

function list(title: string, rows: HTMLElement[]): HTMLElement[] {
  return rows.length ? [h('h2', {}, `${title} (${rows.length})`), h('ul', { className: 'related' }, ...rows)] : []
}

const KIND_NAMES: Record<Item['kind'], string> = { context: 'context', module: 'module', useCase: 'use case', event: 'event', route: 'route' }

function showDetails(): void {
  const item = selected ? index.items.get(selected) : undefined
  if (!item) {
    panel.replaceChildren(h('div', { className: 'empty' },
      h('h2', {}, graph.app.name),
      h('p', {}, 'Select a use case and press ', h('kbd', {}, 'e'), ' to watch everything it sets going: the use cases it calls now, the events it tells, and the workers they wake, in any context, wave after wave.'),
      h('p', {}, h('kbd', {}, 'u'), ' shows the other way: whatever can cause it.'),
      h('p', {}, 'Open and close contexts and modules with a double click, or pick how much to draw with ', h('kbd', {}, '1'), '–', h('kbd', {}, '4'), '.'),
      h('p', {}, `Read from ${graph.app.root} at ${new Date(graph.app.generatedAt).toLocaleString()}.`),
    ))
    return
  }
  const colors = colorOf(item)
  const header = [
    h('span', { className: 'kind', style: { color: colors.stroke, borderColor: colors.stroke } }, KIND_NAMES[item.kind]),
    item.test ? h('span', { className: 'kind' }, 'test') : null,
    h('div', { className: 'title' }, item.title),
    where(item.file, item.line),
  ]
  const actions = h('div', { className: 'actions' },
    item.kind !== 'context' ? h('button', { className: 'primary', onClick: () => startRun(item.id, 'down') }, 'Side effects  e') : null,
    item.kind === 'useCase' || item.kind === 'event' ? h('button', { onClick: () => startRun(item.id, 'up') }, 'Who can cause this?  u') : null,
    item.kind === 'context' || item.kind === 'module' ? h('button', { onClick: () => toggleOpen(item.id) }, isExpanded(state, item) ? 'Close  x' : 'Open  x') : null,
    h('button', { onClick: () => toggleMark(item.id) }, marks.has(item.id) ? 'Unmark  m' : 'Mark  m'),
  )
  const body: (HTMLElement | null)[] = []
  const out = index.outOf(item.id)
  const into = index.into(item.id)
  if (item.kind === 'useCase') {
    const useCase = graph.useCases.find(each => each.id === item.id)!
    body.push(h('dl', { className: 'facts' },
      h('dt', {}, 'module'), h('dd', {}, h('button', { className: 'link', onClick: () => reveal(useCase.module) }, useCase.module)),
      h('dt', {}, 'writesTo'), h('dd', {}, useCase.writesTo.join(', ') || 'none'),
      h('dt', {}, 'retries'), h('dd', {}, useCase.retryOnConflict ? 'on a conflict, if it starts the chain' : 'never (retryOnConflict: false)'),
    ))
    body.push(...list('Calls', out.filter(e => e.kind === 'calls').map(e => itemButton(e.to, e.via ? `via ${e.via}` : undefined))))
    body.push(...list('Emits', out.filter(e => e.kind === 'emits').map(e => itemButton(e.to))))
    body.push(...list('Sets going later (workers)', out.filter(e => e.kind === 'emits').flatMap(emit => index.outOf(emit.to).filter(e => e.kind === 'triggers').map(e => itemButton(e.to, `on ${index.items.get(emit.to)?.label} · ${e.subscription?.strategy === 'fire-and-forget' ? 'memory' : `job, ${e.subscription?.runsIn}'s worker`}`)))))
    body.push(...list('Writes to (outside a worker)', out.filter(e => e.kind === 'writesTo').map(e => itemButton(e.to))))
    body.push(...list('Called by', into.filter(e => e.kind === 'calls').map(e => itemButton(e.from))))
    body.push(...list('Run by a worker on', into.filter(e => e.kind === 'triggers').map(e => itemButton(e.from, subscriptionMeta(e.subscription)))))
    body.push(...list('Routes', into.filter(e => e.kind === 'routes').map(e => itemButton(e.from))))
  } else if (item.kind === 'event') {
    const event = index.eventsById.get(item.id)!
    if (event.schedule) body.push(h('dl', { className: 'facts' }, h('dt', {}, 'cron (UTC)'), h('dd', {}, event.schedule.cron)))
    body.push(...list('Told by', into.filter(e => e.kind === 'emits').map(e => itemButton(e.from))))
    body.push(...list('Subscriptions', graph.subscriptions.filter(each => each.event === item.id).map(each => h('li', {},
      h('span', { className: `badge ${each.strategy === 'handler' ? 'job' : 'memory'}` }, each.strategy === 'handler' ? 'job' : 'memory'),
      h('div', {},
        ...(each.handlers.length ? each.handlers.map(handler => h('button', { className: 'link', onClick: () => reveal(handler) }, index.items.get(handler)?.title ?? handler)) : [h('span', {}, `${each.module} (calls no use case)`)]),
        h('div', { className: 'meta' }, subscriptionMeta(each)),
        where(each.file, each.line),
      ),
    ))))
  } else if (item.kind === 'module') {
    const module = graph.modules.find(each => each.id === item.id)!
    body.push(h('dl', { className: 'facts' },
      h('dt', {}, 'class'), h('dd', {}, module.className),
      h('dt', {}, 'context'), h('dd', {}, module.context),
      h('dt', {}, 'initialized'), h('dd', {}, h('a', { href: editorLink(module.initializedAt.file, module.initializedAt.line) }, `${module.initializedAt.file}:${module.initializedAt.line}`)),
    ))
    body.push(...list('Depends on', module.deps.map(dep => dep.target ? itemButton(dep.target, `${dep.name}${dep.kind === 'port' ? ' (port)' : ''}`) : h('li', {}, h('span', { className: 'meta' }, `${dep.name}: a port`)))))
    body.push(...list('Depended on by', graph.modules.filter(each => each.deps.some(dep => dep.target === module.id)).map(each => itemButton(each.id))))
    body.push(...list('Use cases', graph.useCases.filter(each => each.module === module.id).map(each => itemButton(each.id))))
    body.push(...list('Events', graph.events.filter(each => each.module === module.id).map(each => itemButton(each.id, each.schedule ? each.schedule.cron : undefined))))
    body.push(...list('Workers', graph.subscriptions.filter(each => each.module === module.id).map(each => itemButton(each.handlers[0] ?? each.module, `on ${each.event} · ${each.strategy === 'handler' ? 'job' : 'memory'}`))))
  } else if (item.kind === 'context') {
    const context = graph.contexts.find(each => each.id === item.id)!
    body.push(h('dl', { className: 'facts' }, h('dt', {}, 'uses'), h('dd', {}, context.uses === null ? 'not declared' : context.uses.join(', ') || 'no other context')))
    body.push(...list('Modules', graph.modules.filter(each => each.context === context.id && (state.showTests || !each.test)).map(each => itemButton(each.id))))
    body.push(...list('Schedules', graph.events.filter(each => each.context === context.id && each.schedule).map(each => itemButton(each.id, each.schedule!.cron))))
    body.push(...list('Jobs its worker runs for other contexts', graph.subscriptions.filter(each => each.runsIn === context.id && each.context !== context.id).map(each => itemButton(each.handlers[0] ?? each.module, `on ${each.event}`))))
  } else if (item.kind === 'route') {
    const route = graph.routes.find(each => each.id === item.id)!
    body.push(h('dl', { className: 'facts' }, h('dt', {}, 'method'), h('dd', {}, route.method), h('dt', {}, 'path'), h('dd', {}, route.path)))
    body.push(...list('Calls', route.useCases.map(each => itemButton(each))))
  }
  fill(panel, ...header, actions, ...body)
}

function subscriptionMeta(subscription: FineEdge['subscription']): string {
  if (!subscription) return ''
  if (subscription.strategy === 'fire-and-forget') return `in memory after the commit, lost if it fails${subscription.filtered ? ' · when' : ''}`
  return `job of ${subscription.runsIn}'s outbox, run by its worker · ${subscription.queue} · ${subscription.attempts} attempts${subscription.filtered ? ' · when' : ''}`
}

function showEdge(edge: DisplayEdge): void {
  const from = index.items.get(edge.from)
  const to = index.items.get(edge.to)
  const what: Record<DisplayEdge['group'], string> = {
    calls: 'calls', events: 'sets going, through events', schedules: 'runs on a schedule', writesTo: 'writes to (writesTo)', routes: 'routes to', depends: 'is given', uses: 'may use',
  }
  fill(panel,
    h('span', { className: 'kind' }, `${edge.group}${edge.violation ? ' · crosses a boundary' : ''}`),
    h('div', { className: 'title' }, `${from?.title ?? edge.from} ${what[edge.group]} ${to?.title ?? edge.to}`),
    edge.violation ? h('p', { className: 'note' }, `${from?.context} does not list ${to?.context} in its uses (newt-eslint).`) : null,
    ...list('What it is made of', edge.fine.map(fine => h('li', {},
      h('div', {},
        h('button', { className: 'link', onClick: () => reveal(fine.from) }, index.items.get(fine.from)?.title ?? fine.from),
        ' → ',
        h('button', { className: 'link', onClick: () => reveal(fine.to) }, index.items.get(fine.to)?.title ?? fine.to),
        h('div', { className: 'meta' }, fine.kind === 'event' ? `on ${fine.via} · ${subscriptionMeta(fine.subscription)}` : fine.subscription ? subscriptionMeta(fine.subscription) : fine.via ? `via ${fine.via}` : fine.kind),
        where(fine.file, fine.line),
      ),
    ))),
  )
}

// ------------------------------------------------------------------ the chain, animated

type Run = { chain: Chain, start: string, frame: number, playing: boolean, timer: number, speed: number, isolate: boolean, rows: HTMLElement[] }
let run: Run | null = null
let pulseId = 0

function startRun(id: string, direction: 'down' | 'up'): void {
  stopRun(false)
  const chain = chainOf(index, id, direction)
  if (chain.frames.length <= 1 && chain.items.size <= 1) {
    toastMessage(direction === 'down' ? 'It sets nothing else going' : 'Nothing in the code causes it')
  }
  run = { chain, start: id, frame: 0, playing: true, timer: 0, speed: 1, isolate: true, rows: [] }
  // Routes in the chain are drawn, to be seen.
  if ([...chain.items].some(item => index.items.get(item)?.kind === 'route') && !state.groups.has('routes')) {
    state.groups.add('routes')
    syncControls()
  }
  selected = id
  updateFocus()
  render()
  renderRunPanel()
  window.setTimeout(() => playFrom(0), 650)
}

function stopRun(redraw = true): void {
  if (!run) return
  clearTimeout(run.timer)
  run = null
  cy.$('.pulse').remove()
  updateFocus()
  if (redraw) {
    render({ fit: false })
    showDetails()
  }
}

const waveColor = (wave: number) => {
  const waves = PALETTES[theme()].waves
  return waves[Math.min(wave, waves.length - 1)]!
}


/** Paints the chain as far as it has played: what is reached lit in its wave's colour, the rest faded. */
function paintRun(): void {
  if (!run) return
  const { chain, frame } = run
  cy.elements().not('.pulse').addClass('faded').removeClass('reached lit root')
  for (const start of index.starts(run.start)) {
    const shown = view.rep(start)
    if (shown) cy.getElementById(shown).removeClass('faded').addClass('reached root').data({ wave: waveColor(0) })
  }
  for (let n = 0; n < frame && n < chain.frames.length; n++) paintFrame(n, false)
  cy.nodes(':parent').forEach(parent => {
    if (parent.descendants().not('.faded').nonempty()) parent.removeClass('faded')
  })
}


function paintFrame(n: number, animate: boolean): void {
  if (!run) return
  const frame = run.chain.frames[n]
  if (!frame) return
  const color = waveColor(frame.wave)
  const duration = 650 / run.speed
  for (const edge of frame.edges) {
    const shownId = view.edgeOf.get(edge.id)
    const from = view.rep(edge.from)
    const to = view.rep(edge.to)
    if (shownId) {
      const shown = cy.getElementById(shownId)
      shown.data('wave', color).removeClass('faded').addClass('lit')
      if (animate) pulse(shown, color, duration)
    } else if (animate && from && to && from !== to) {
      // An edge not drawn on its own (its event between, at this granularity): the pulse goes anyway.
      pulseBetween(cy.getElementById(from), cy.getElementById(to), color, duration)
    }
    for (const id of [from, to]) {
      if (!id) continue
      const node = cy.getElementById(id)
      node.removeClass('faded')
      node.ancestors().removeClass('faded')
    }
  }
  for (const item of frame.nodes) {
    const shown = view.rep(item)
    if (!shown) continue
    const node = cy.getElementById(shown)
    const reached = () => {
      if (!node.hasClass('reached')) node.data({ wave: color })
      node.removeClass('faded').addClass('reached')
      node.ancestors().removeClass('faded')
    }
    if (animate) window.setTimeout(reached, duration * 0.85)
    else reached()
  }
}

function pulse(edge: cytoscape.CollectionReturnValue, color: string, duration: number): void {
  const shown = edge as unknown as cytoscape.EdgeSingular
  pulseBetween(shown.source(), shown.target(), color, duration)
}

type Placed = { empty(): boolean, position(): cytoscape.Position }

/** A dot travelling from one node to another: what goes along an edge. */
function pulseBetween(source: Placed, target: Placed, color: string, duration: number): void {
  if (source.empty() || target.empty()) return
  const from = source.position()
  const to = target.position()
  const dot = cy.add({ group: 'nodes', data: { id: `pulse-${pulseId++}`, wave: color }, classes: 'pulse', position: { ...from }, grabbable: false, selectable: false })
  dot.animate({ position: { ...to } }, { duration, easing: 'ease-in-out-cubic', complete: () => dot.remove() })
}

function playFrom(n: number): void {
  if (!run) return
  clearTimeout(run.timer)
  run.frame = n
  run.playing = true
  const tick = () => {
    if (!run || !run.playing) return
    if (run.frame >= run.chain.frames.length) {
      run.playing = false
      renderRunPanel()
      return
    }
    const next = run.chain.frames[run.frame + 1]
    const current = run.chain.frames[run.frame]!
    paintFrame(run.frame, true)
    run.frame++
    renderRunPanel()
    // A pause where a wave ends: what comes next is a worker's, later.
    const gap = next && next.wave !== current.wave ? 650 : 120
    run.timer = window.setTimeout(tick, 650 / run.speed + gap / run.speed)
  }
  tick()
}

function pause(): void {
  if (!run) return
  run.playing = false
  clearTimeout(run.timer)
  renderRunPanel()
}

function togglePlay(): void {
  if (!run) return
  if (run.playing) pause()
  else if (run.frame >= run.chain.frames.length) replay()
  else playFrom(run.frame)
}

function replay(): void {
  if (!run) return
  pause()
  run.frame = 0
  cy.$('.pulse').remove()
  paintRun()
  playFrom(0)
}

function step(delta: number): void {
  if (!run) return
  pause()
  if (delta > 0 && run.frame < run.chain.frames.length) {
    paintFrame(run.frame, true)
    run.frame++
  } else if (delta < 0 && run.frame > 0) {
    run.frame--
    paintRun()
  }
  renderRunPanel()
}

function renderRunPanel(): void {
  if (!run) return
  const { chain, frame } = run
  const item = index.items.get(run.start)
  const total = chain.frames.length
  const current = chain.frames[Math.max(0, frame - 1)]
  const waves = [...new Set(chain.frames.map(each => each.wave))]
  const status = frame === 0 ? 'Ready' : `Step ${frame} of ${total}`
  const waveText = current ? (current.wave === 0 ? (chain.direction === 'down' ? 'now, in the request' : 'the one it starts from') : `${current.wave === 1 ? 'a worker' : `${current.wave} worker hops`}${chain.direction === 'down' ? ' later' : ' earlier'}`) : ''
  const button = (label: string, title: string, action: () => void, pressed?: boolean) => h('button', { title, 'aria-label': title, 'aria-pressed': pressed === undefined ? undefined : String(pressed), onClick: action }, label)
  run.rows = []
  const tree = h('ul', { className: 'tree' }, ...chain.roots.map(root => chainRow(root, chain.direction)))
  panel.replaceChildren(
    h('div', { className: 'player' },
      h('span', { className: 'kind' }, chain.direction === 'down' ? 'side effects' : 'who can cause it'),
      h('div', { className: 'title' }, item?.title ?? run.start),
      h('div', { className: 'controls' },
        button('⏮', 'Replay (r)', replay),
        button('◀', 'Step back (←)', () => step(-1)),
        button(run.playing ? '❚❚' : '▶', run.playing ? 'Pause (space)' : 'Play (space)', togglePlay),
        button('▶|', 'Step (→)', () => step(1)),
        h('select', { 'aria-label': 'Speed', onChange: (event: Event) => { if (run) run.speed = Number((event.target as HTMLSelectElement).value) } },
          ...[0.5, 1, 2, 4].map(speed => h('option', { value: String(speed), selected: speed === run!.speed }, `${speed}×`))),
        button('Only the chain', 'Only the chain, or everything faded around it (i)', () => toggleIsolate(), run.isolate),
        button('×', 'Close (Esc)', () => stopRun()),
      ),
      h('div', { className: 'status' }, h('strong', {}, status), waveText ? ` · ${waveText}` : ''),
      h('div', { className: 'waves' }, ...waves.map(wave => h('span', {}, h('span', { className: 'dot', style: { background: waveColor(wave) } }), wave === 0 ? 'now' : `${wave} worker hop${wave > 1 ? 's' : ''}`))),
    ),
    tree,
  )
  for (const row of run.rows) {
    const rowFrame = Number(row.dataset.frame)
    row.classList.toggle('done', rowFrame < frame)
    row.classList.toggle('current', rowFrame === frame - 1)
  }
  run.rows.find(row => row.classList.contains('current'))?.scrollIntoView({ block: 'nearest' })
}

function chainRow(node: ChainNode, direction: 'down' | 'up'): HTMLElement {
  const item = index.items.get(node.item)
  const edge = node.edge
  let badge = 'start'
  let badgeText = direction === 'down' ? 'start' : 'this'
  let meta = ''
  if (edge) {
    if (edge.kind === 'calls') { badge = 'call'; badgeText = direction === 'down' ? 'calls' : 'called by'; meta = edge.via ? `now, via ${edge.via}` : 'now, in the same request' }
    if (edge.kind === 'routes') { badge = 'route'; badgeText = direction === 'down' ? 'calls' : 'route'; meta = 'an entry point' }
    if (edge.kind === 'writesTo') { badge = 'writes'; badgeText = 'writes'; meta = 'writesTo: writes to this module outside a worker, said in @UseCase' }
    if (edge.kind === 'emits') { badge = 'event'; badgeText = direction === 'down' ? 'tells' : 'told by'; meta = 'after its save commits' }
    if (edge.kind === 'triggers') {
      const memory = edge.subscription?.strategy === 'fire-and-forget'
      badge = memory ? 'memory' : 'job'
      badgeText = memory ? 'memory' : 'job'
      meta = subscriptionMeta(edge.subscription)
    }
  } else if (item?.kind === 'event' && item.schedule) {
    badge = 'schedule'
    badgeText = 'cron'
    meta = item.schedule
  }
  if (node.repeat) {
    badge = 'again'
    meta = `${meta}${meta ? ' · ' : ''}shown above`
  }
  const row = h('button', { className: 'row', 'data-frame': String(node.frame), onClick: () => reveal(node.item) },
    h('span', { className: `badge ${badge}` }, badgeText),
    h('span', { className: 'label' }, h('span', { className: 'dot', style: { background: item ? colorOf(item).stroke : 'gray' } }), h('span', {}, item?.title ?? node.item)),
    meta ? h('span', { className: 'meta' }, meta) : null,
  )
  run?.rows.push(row)
  return h('li', {}, row, node.children.length ? h('ul', {}, ...node.children.map(child => chainRow(child, direction))) : null)
}

function toggleIsolate(): void {
  if (!run) return
  run.isolate = !run.isolate
  updateFocus()
  render()
  renderRunPanel()
}

// ------------------------------------------------------------------ search

type Hit = { item: Item, score: number }
let hits: Hit[] = []
let active = 0

function search(query: string): void {
  if (!query.trim()) {
    results.hidden = true
    return
  }
  hits = [...index.items.values()]
    .filter(item => state.showTests || !item.test)
    .map(item => {
      const scores = [fuzzyScore(query, item.title), fuzzyScore(query, item.label), item.kind === 'route' ? fuzzyScore(query, item.title) : null]
      const best = Math.max(...scores.map(each => each ?? -Infinity))
      return { item, score: best + (item.kind === 'useCase' ? 3 : 0) }
    })
    .filter(hit => hit.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
  active = 0
  renderResults()
}

function renderResults(): void {
  results.replaceChildren(...hits.map((hit, n) => h('button', {
    className: 'result',
    role: 'option',
    'aria-selected': String(n === active),
    onMousedown: (event: Event) => { event.preventDefault(); choose(n) },
  },
  h('span', { className: 'kind', style: { color: colorOf(hit.item).stroke, borderColor: colorOf(hit.item).stroke } }, KIND_NAMES[hit.item.kind]),
  h('span', {}, hit.item.label),
  h('span', { className: 'sub' }, hit.item.title),
  )))
  if (hits.length === 0) results.replaceChildren(h('div', { className: 'note', style: { padding: '6px 8px' } }, 'Nothing matches'))
  results.hidden = false
}

function choose(n: number): void {
  const hit = hits[n]
  if (!hit) return
  results.hidden = true
  searchInput.value = ''
  searchInput.blur()
  stopRun(false)
  reveal(hit.item.id)
}

searchInput.addEventListener('input', () => search(searchInput.value))
searchInput.addEventListener('focus', () => { if (searchInput.value) search(searchInput.value) })
searchInput.addEventListener('blur', () => window.setTimeout(() => { results.hidden = true }, 120))
searchInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { active = Math.min(active + 1, hits.length - 1); renderResults(); event.preventDefault() }
  if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderResults(); event.preventDefault() }
  if (event.key === 'Enter') { choose(active); event.preventDefault() }
  if (event.key === 'Escape') { results.hidden = true; searchInput.blur() }
})

// ------------------------------------------------------------------ keys

document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || event.metaKey || event.ctrlKey || event.altKey) return
  const key = event.key
  const level = GRANULARITIES.find(each => each.key === key)
  if (level) setGranularity(level.id)
  else if (key === '/') { searchInput.focus(); event.preventDefault() }
  else if (key === 'e' && selected) startRun(selected, 'down')
  else if (key === 'u' && selected) startRun(selected, 'up')
  else if (key === ' ' && run) { togglePlay(); event.preventDefault() }
  else if ((key === 'ArrowRight' || key === '.') && run) step(1)
  else if ((key === 'ArrowLeft' || key === ',') && run) step(-1)
  else if (key === 'r' && run) replay()
  else if (key === 'i' && run) toggleIsolate()
  else if (key === 'm' && selected) toggleMark(selected)
  else if (key === 'x' && selected) toggleOpen(selected)
  else if (key === 's') { focusSelection = !focusSelection; updateFocus(); render(); renderSide(); toastMessage(focusSelection ? 'Only what touches the selection' : 'Everything') }
  else if (key === 'd') toggleDepsView()
  else if (key === 'f') cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 300 })
  else if (key === 't') cycleTheme()
  else if (key === '?') helpOverlay.hidden = !helpOverlay.hidden
  else if (key === 'Escape') {
    if (!helpOverlay.hidden) helpOverlay.hidden = true
    else if (run) stopRun()
    else select(null)
  } else return
})

// ------------------------------------------------------------------ start

document.documentElement.dataset.theme = theme()
syncControls()
render()
showDetails()
