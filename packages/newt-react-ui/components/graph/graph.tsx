import { useContext, useMemo, useState } from 'react'
import { cn } from 'cn'
import { LinkComponentContext } from '../link/link-component'
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH, type GraphEdge, type GraphNode, type PlacedNode } from './graph-layout'

export type { GraphEdge, GraphNode } from './graph-layout'

type GraphProps = {
  /** What the graph shows, for screen readers. */
  label: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/**
 * A small graph of what uses what, laid out in columns: what is used on the left, an
 * arrow from each node to each one it uses. Hovering or focusing a node brings out its
 * arrows and its neighbours; a node with `href` is a link. Meant for a few nodes: a
 * screen shows one piece, never everything.
 */
export function Graph({ label, nodes, edges }: GraphProps) {
  const layout = useMemo(() => layoutGraph(nodes, edges), [nodes, edges])
  const [focused, setFocused] = useState<string | null>(null)
  const byId = new Map(layout.nodes.map(node => [node.id, node]))
  const drawn = edges.filter(edge => byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to)
  const near = focused === null
    ? null
    : new Set([focused, ...drawn.flatMap(edge => (edge.from === focused ? [edge.to] : edge.to === focused ? [edge.from] : []))])
  const lit = (edge: GraphEdge) => focused !== null && (edge.from === focused || edge.to === focused)
  // An arrow that skips a column arcs over it, so it never runs under a box: room above for it.
  const ports = portsOf(drawn, byId)
  const top = drawn.some(edge => byId.get(edge.from)!.column - byId.get(edge.to)!.column > 1) ? ARC : 0

  return (
    <div role="group" aria-label={label} className="overflow-x-auto">
      <div className="relative" style={{ width: layout.width, height: layout.height + top, paddingTop: top }}>
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          {layout.groups.map(group => (
            <div
              key={group.id}
              className="absolute rounded-md border border-dashed bg-subtle/60"
              style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
            >
              <p className="truncate px-2.5 pt-1 text-xs font-medium text-muted-foreground">{group.label}</p>
            </div>
          ))}
          <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
            <defs>
              <marker id="graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" className="fill-muted-foreground/60" />
              </marker>
              <marker id="graph-arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" className="fill-brand" />
              </marker>
            </defs>
            {/* The lit ones last, so they are drawn over the rest. */}
            {[...drawn.filter(edge => !lit(edge)), ...drawn.filter(lit)].map(edge => (
              <path
                key={`${edge.from}>${edge.to}`}
                d={curve(byId.get(edge.from)!, byId.get(edge.to)!, ports.get(edge)!)}
                fill="none"
                strokeWidth={lit(edge) ? 1.75 : 1.25}
                strokeDasharray={edge.dashed ? '4 4' : undefined}
                markerEnd={`url(#${lit(edge) ? 'graph-arrow-lit' : 'graph-arrow'})`}
                className={cn('transition-opacity', lit(edge) ? 'stroke-brand' : 'stroke-muted-foreground/50', focused !== null && !lit(edge) && 'opacity-25')}
              />
            ))}
          </svg>
          {layout.nodes.map(node => (
            <div
              key={node.id}
              className={cn('absolute transition-opacity', near !== null && !near.has(node.id) && 'opacity-40')}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              onMouseEnter={() => setFocused(node.id)}
              onMouseLeave={() => setFocused(null)}
              onFocusCapture={() => setFocused(node.id)}
              onBlurCapture={() => setFocused(null)}
            >
              <GraphBox node={node} />
            </div>
          ))}
          </div>
      </div>
    </div>
  )
}

function GraphBox({ node }: { node: PlacedNode }) {
  const Link = useContext(LinkComponentContext)
  const look = cn(
    'flex h-full w-full items-center rounded-md border bg-card px-3 text-sm shadow-xs outline-none',
    node.emphasis ? 'border-brand font-semibold text-foreground ring-1 ring-brand' : 'text-foreground',
    node.href && 'transition-colors hover:border-brand hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50',
  )
  const text = <span className="truncate">{node.label}</span>
  return node.href ? <Link href={node.href} className={look} aria-label={node.label}>{text}</Link> : <div className={look}>{text}</div>
}

/** How far above the boxes an arrow that skips a column arcs. */
const ARC = 28

/**
 * Where each arrow leaves its node and reaches the other: spread along their sides, in
 * the order of the nodes at the other end, so two arrows never meet at one point.
 */
function portsOf(edges: GraphEdge[], byId: Map<string, PlacedNode>): Map<GraphEdge, { start: number, end: number }> {
  const offset = (index: number, count: number) => (index - (count - 1) / 2) * Math.min(12, (NODE_HEIGHT - 10) / Math.max(1, count - 1))
  const ports = new Map<GraphEdge, { start: number, end: number }>()
  const byY = (id: string) => byId.get(id)!.y
  for (const edge of edges) {
    const leaving = edges.filter(each => each.from === edge.from).sort((a, b) => byY(a.to) - byY(b.to))
    const arriving = edges.filter(each => each.to === edge.to).sort((a, b) => byY(a.from) - byY(b.from))
    ports.set(edge, { start: offset(leaving.indexOf(edge), leaving.length), end: offset(arriving.indexOf(edge), arriving.length) })
  }
  return ports
}

/** From the left side of the node that uses to the right side of the one used, curving between. */
function curve(from: PlacedNode, to: PlacedNode, port: { start: number, end: number }): string {
  const start = { x: from.x, y: from.y + NODE_HEIGHT / 2 + port.start }
  const end = { x: to.x + NODE_WIDTH, y: to.y + NODE_HEIGHT / 2 + port.end }
  if (from.column === to.column) {
    // Side by side in a column: around their left side.
    const left = from.x - 28
    return `M ${start.x} ${start.y} C ${left} ${start.y}, ${left} ${end.y}, ${to.x} ${end.y}`
  }
  const bend = Math.max(32, Math.abs(start.x - end.x) / 2)
  if (from.column - to.column > 1) {
    // Over the columns between, above their boxes.
    const over = Math.min(start.y, end.y) - ARC * 1.4
    return `M ${start.x} ${start.y} C ${start.x - 24} ${over}, ${end.x + 24} ${over}, ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} C ${start.x - bend} ${start.y}, ${end.x + bend} ${end.y}, ${end.x} ${end.y}`
}
