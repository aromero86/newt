import type { GraphIndex, Item } from './graph-index'

export type Theme = 'light' | 'dark'

export type Palette = {
  bg: string
  surface: string
  text: string
  muted: string
  border: string
  accent: string
  mark: string
  compoundOpacity: number
  collapsedOpacity: number
  edges: Record<'calls' | 'events' | 'schedules' | 'writesTo' | 'routes' | 'depends' | 'uses' | 'violation', string>
  waves: string[]
}

export const PALETTES: Record<Theme, Palette> = {
  light: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    text: '#1c2230',
    muted: '#667085',
    border: '#d9dde5',
    accent: '#2563eb',
    mark: '#eab308',
    compoundOpacity: 0.07,
    collapsedOpacity: 0.16,
    edges: { calls: '#475569', events: '#d97706', schedules: '#7c3aed', writesTo: '#dc2626', routes: '#98a2b3', depends: '#98a2b3', uses: '#16a34a', violation: '#e11d48' },
    waves: ['#2563eb', '#d97706', '#c026d3', '#0d9488', '#7c3aed', '#dc2626'],
  },
  dark: {
    bg: '#0e1117',
    surface: '#171b24',
    text: '#e6e8ee',
    muted: '#98a2b3',
    border: '#2b3240',
    accent: '#60a5fa',
    mark: '#facc15',
    compoundOpacity: 0.1,
    collapsedOpacity: 0.24,
    edges: { calls: '#a3aec2', events: '#fbbf24', schedules: '#c4b5fd', writesTo: '#f87171', routes: '#667085', depends: '#667085', uses: '#4ade80', violation: '#fb7185' },
    waves: ['#60a5fa', '#fbbf24', '#e879f9', '#2dd4bf', '#a78bfa', '#f87171'],
  },
}

/** A hue for each context, apart enough to tell them at a glance. */
const HUES = [214, 150, 26, 282, 346, 188, 46, 252, 98, 320]

export type Colors = { stroke: string, fill: string, soft: string }

/**
 * Each context its hue; each module of it a shade of that hue, a little lighter or
 * darker and turned a few degrees, so modules side by side differ and still read as
 * their context's.
 */
export function colorsFor(index: GraphIndex, theme: Theme): (item: Item) => Colors {
  const contexts = index.graph.contexts.map(each => each.id)
  const hueOf = new Map(contexts.map((id, n) => [id, HUES[n % HUES.length]!]))
  const moduleShift = new Map<string, { hue: number, light: number }>()
  for (const context of contexts) {
    const modules = index.graph.modules.filter(each => each.context === context)
    modules.forEach((module, n) => {
      const spread = modules.length > 1 ? n / (modules.length - 1) - 0.5 : 0
      moduleShift.set(module.id, { hue: spread * 34, light: (n % 2 === 0 ? 1 : -1) * 6 })
    })
  }
  const dark = theme === 'dark'
  return item => {
    const hue = hueOf.get(item.context) ?? 210
    const shift = item.kind === 'context' ? { hue: 0, light: 0 } : moduleShift.get(item.module ?? '') ?? { hue: 0, light: 0 }
    const h = Math.round(hue + shift.hue)
    const l = (dark ? 64 : 44) + shift.light
    const [r, g, b] = hslToRgb(h, 0.62, l / 100)
    return {
      stroke: `rgb(${r}, ${g}, ${b})`,
      fill: `rgba(${r}, ${g}, ${b}, ${dark ? 0.14 : 0.08})`,
      soft: `rgba(${r}, ${g}, ${b}, ${dark ? 0.32 : 0.2})`,
    }
  }
}

/** Cytoscape takes rgb() and rgba(), not every way CSS writes a colour. */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const k = (n: number) => (n + hue / 30) % 12
  const a = saturation * Math.min(lightness, 1 - lightness)
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map(each => Math.round(each * 255)) as [number, number, number]
}

/** Cytoscape's stylesheet for a theme. */
export function graphStyle(palette: Palette): unknown[] {
  const edge = (group: keyof Palette['edges']) => `edge[group = "${group}"]`
  return [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'color': palette.text,
        'font-family': 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        'font-size': 11,
        'text-valign': 'center',
        'text-halign': 'center',
        'background-color': palette.surface,
        'border-width': 1.5,
        'border-color': 'data(stroke)',
        'shape': 'round-rectangle',
        'width': 'data(w)',
        'height': 'data(h)',
        'padding': '0px',
        'min-zoomed-font-size': 5,
        'transition-property': 'opacity, background-color, border-color, border-width',
        'transition-duration': 250,
      },
    },
    {
      selector: 'node[kind = "context"]:parent, node[kind = "module"]:parent',
      style: {
        'background-color': 'data(stroke)',
        'background-opacity': palette.compoundOpacity,
        'border-color': 'data(stroke)',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -4,
        'font-weight': 600,
        'padding': '14px',
        'shape': 'round-rectangle',
      },
    },
    {
      selector: 'node[kind = "context"]',
      style: { 'font-size': 15, 'font-weight': 700, 'border-width': 2.5, 'text-transform': 'uppercase', 'color': 'data(stroke)' },
    },
    {
      selector: 'node[kind = "context"]:parent',
      style: { 'padding': '22px', 'font-size': 14 },
    },
    {
      selector: 'node[kind = "module"]',
      style: { 'font-size': 12, 'font-weight': 600, 'border-width': 2, 'color': palette.text },
    },
    {
      selector: 'node.collapsed',
      style: {
        'background-color': 'data(stroke)',
        'background-opacity': palette.collapsedOpacity,
        'text-wrap': 'wrap',
        'border-style': 'solid',
      },
    },
    {
      selector: 'node[kind = "context"].collapsed',
      style: { 'font-size': 16, 'border-width': 3 },
    },
    {
      selector: 'node[kind = "event"]',
      style: { 'shape': 'diamond', 'width': 14, 'height': 14, 'background-color': 'data(stroke)', 'border-width': 0, 'font-size': 9, 'text-valign': 'bottom', 'text-margin-y': 3, 'color': palette.muted, 'padding': '0px' },
    },
    {
      selector: 'node[kind = "event"][?schedule]',
      style: { 'shape': 'ellipse', 'width': 18, 'height': 18, 'background-color': palette.surface, 'border-width': 3, 'border-color': palette.edges.schedules, 'color': palette.edges.schedules, 'font-weight': 600 },
    },
    {
      selector: 'node[kind = "route"]',
      style: { 'shape': 'tag', 'font-size': 9, 'height': 16, 'color': palette.muted, 'border-width': 1, 'border-color': palette.edges.routes, 'border-style': 'dashed' },
    },
    { selector: 'node.test', style: { 'border-style': 'dotted' } },
    {
      selector: 'node.marked',
      style: { 'underlay-color': palette.mark, 'underlay-padding': 5, 'underlay-opacity': 0.55, 'underlay-shape': 'round-rectangle' },
    },
    {
      selector: 'node:selected',
      style: { 'border-width': 3, 'border-color': palette.accent, 'overlay-color': palette.accent, 'overlay-opacity': 0.08, 'overlay-padding': 4 },
    },
    {
      selector: 'edge',
      style: {
        'width': 'data(width)',
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'line-color': palette.edges.calls,
        'target-arrow-color': palette.edges.calls,
        'opacity': 0.75,
        'label': 'data(label)',
        'font-size': 9,
        'color': palette.muted,
        'text-background-color': palette.bg,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'text-rotation': 'none',
        'min-zoomed-font-size': 8,
        'transition-property': 'opacity, line-color, width',
        'transition-duration': 250,
      },
    },
    { selector: edge('events'), style: { 'line-color': palette.edges.events, 'target-arrow-color': palette.edges.events, 'line-style': 'dashed', 'line-dash-pattern': [6, 4], 'target-arrow-shape': 'vee' } },
    { selector: edge('schedules'), style: { 'line-color': palette.edges.schedules, 'target-arrow-color': palette.edges.schedules, 'line-style': 'dashed', 'line-dash-pattern': [2, 3], 'target-arrow-shape': 'vee' } },
    { selector: edge('writesTo'), style: { 'line-color': palette.edges.writesTo, 'target-arrow-color': palette.edges.writesTo, 'target-arrow-shape': 'square', 'arrow-scale': 0.6 } },
    { selector: edge('routes'), style: { 'line-color': palette.edges.routes, 'target-arrow-color': palette.edges.routes, 'width': 1, 'line-style': 'dotted' } },
    { selector: edge('depends'), style: { 'line-color': palette.edges.depends, 'target-arrow-color': palette.edges.depends, 'line-style': 'dotted', 'target-arrow-shape': 'triangle-tee', 'opacity': 0.6 } },
    { selector: edge('uses'), style: { 'line-color': palette.edges.uses, 'target-arrow-color': palette.edges.uses, 'width': 6, 'opacity': 0.35, 'label': 'uses', 'color': palette.edges.uses, 'font-weight': 700, 'z-index': 0 } },
    { selector: 'edge.violation', style: { 'line-color': palette.edges.violation, 'target-arrow-color': palette.edges.violation, 'width': 3, 'opacity': 1 } },
    { selector: 'edge:selected', style: { 'line-color': palette.accent, 'target-arrow-color': palette.accent, 'opacity': 1, 'width': 3 } },
    { selector: '.faded', style: { 'opacity': 0.12 } },
    { selector: 'node.faded:parent', style: { 'opacity': 0.35 } },
    { selector: '.touching', style: { 'opacity': 1 } },
    { selector: 'node.reached', style: { 'border-color': 'data(wave)', 'border-width': 3, 'background-color': 'data(wave)', 'background-opacity': 0.22 } },
    { selector: 'node.root', style: { 'border-width': 4 } },
    { selector: 'edge.lit', style: { 'line-color': 'data(wave)', 'target-arrow-color': 'data(wave)', 'width': 3.5, 'opacity': 1, 'z-index': 10 } },
    {
      selector: 'node.pulse',
      style: { 'shape': 'ellipse', 'width': 12, 'height': 12, 'background-color': 'data(wave)', 'border-width': 3, 'border-color': palette.surface, 'label': '', 'z-index': 100, 'events': 'no' },
    },
  ]
}
