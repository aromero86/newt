/** A box of a graph: its name, where it leads, and the group it is drawn inside, if any. */
export type GraphNode = {
  id: string
  label: string
  href?: string
  /** Nodes of the same group are drawn together inside one box with its name: a context's modules. */
  group?: string
  /** The one the graph is about: drawn in the brand's colour. */
  emphasis?: boolean
}

/** `from` uses `to`: the arrow points at what is used, which sits to its left. */
export type GraphEdge = {
  from: string
  to: string
  /** A looser link, such as a reaction to an event. */
  dashed?: boolean
}

export const NODE_WIDTH = 168
export const NODE_HEIGHT = 34
const COLUMN_GAP = 72
const ROW_GAP = 10
/** Room inside a group's box: around its nodes, and above them for its name. */
const GROUP_PADDING = 10
const GROUP_TITLE = 22
const GROUP_GAP = 16

export type PlacedNode = GraphNode & { x: number, y: number, column: number }
export type PlacedGroup = { id: string, label: string, x: number, y: number, width: number, height: number }
export type GraphLayout = { nodes: PlacedNode[], groups: PlacedGroup[], width: number, height: number }

/**
 * Where everything goes: what nothing else uses sits furthest right, and each node one
 * column right of the furthest it uses, so every arrow points left. A cycle is cut
 * where it is found. In a column, nodes go by group, then by name; a group's nodes
 * stay together, inside its box.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  const ids = new Set(nodes.map(node => node.id))
  const uses = new Map<string, string[]>()
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue
    uses.set(edge.from, [...uses.get(edge.from) ?? [], edge.to])
  }

  const columns = new Map<string, number>()
  const visiting = new Set<string>()
  const columnOf = (id: string): number => {
    const known = columns.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return -1
    visiting.add(id)
    const column = Math.max(-1, ...(uses.get(id) ?? []).map(columnOf)) + 1
    visiting.delete(id)
    columns.set(id, column)
    return column
  }
  for (const node of nodes) columnOf(node.id)

  const placed: PlacedNode[] = []
  const groups: PlacedGroup[] = []
  let height = 0
  const columnCount = Math.max(0, ...columns.values()) + 1
  for (let column = 0; column < columnCount; column++) {
    const x = column * (NODE_WIDTH + 2 * GROUP_PADDING + COLUMN_GAP)
    const inColumn = nodes
      .filter(node => columns.get(node.id) === column)
      .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label))
    let y = 0
    let index = 0
    while (index < inColumn.length) {
      const group = inColumn[index]!.group
      const members = []
      while (index < inColumn.length && inColumn[index]!.group === group) members.push(inColumn[index++]!)
      const top = y
      if (group !== undefined) y += GROUP_TITLE
      for (const node of members) {
        placed.push({ ...node, column, x: x + GROUP_PADDING, y })
        y += NODE_HEIGHT + ROW_GAP
      }
      y += GROUP_PADDING - ROW_GAP
      if (group !== undefined) groups.push({ id: `${group}:${column}`, label: group, x, y: top, width: NODE_WIDTH + 2 * GROUP_PADDING, height: y + GROUP_PADDING - top - GROUP_PADDING })
      y += GROUP_GAP
    }
    height = Math.max(height, y - GROUP_GAP)
  }
  const width = columnCount * (NODE_WIDTH + 2 * GROUP_PADDING) + Math.max(0, columnCount - 1) * COLUMN_GAP
  return { nodes: placed, groups, width, height }
}
