import { describe, expect, test } from 'bun:test'
import { layoutGraph } from './graph-layout'

describe('a graph\'s layout', () => {
  test('puts what is used to the left of what uses it', () => {
    const { nodes } = layoutGraph(
      [{ id: 'backoffice', label: 'backoffice' }, { id: 'boards', label: 'boards' }, { id: 'auth', label: 'auth' }],
      [{ from: 'boards', to: 'auth' }, { from: 'backoffice', to: 'auth' }, { from: 'backoffice', to: 'boards' }],
    )
    const column = Object.fromEntries(nodes.map(node => [node.id, node.column]))
    expect(column).toEqual({ auth: 0, boards: 1, backoffice: 2 })
  })

  test('keeps a group\'s nodes together in its box, and survives a cycle', () => {
    const { nodes, groups } = layoutGraph(
      [{ id: 'a', label: 'a', group: 'auth' }, { id: 'c', label: 'c' }, { id: 'b', label: 'b', group: 'auth' }, { id: 'd', label: 'd' }],
      [{ from: 'c', to: 'a' }, { from: 'c', to: 'b' }, { from: 'd', to: 'c' }, { from: 'c', to: 'd' }],
    )
    const [a, b] = ['a', 'b'].map(id => nodes.find(node => node.id === id)!)
    expect(a!.column).toBe(0)
    expect(b!.y).toBeGreaterThan(a!.y)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.y).toBeLessThan(a!.y)
    expect(groups[0]!.y + groups[0]!.height).toBeGreaterThan(b!.y)
    expect(nodes).toHaveLength(4)
  })

  test('puts a node given its column there', () => {
    const { nodes } = layoutGraph([{ id: 'a', label: 'a', column: 1 }, { id: 'b', label: 'b' }], [])
    expect(nodes.find(node => node.id === 'a')!.column).toBe(1)
    expect(nodes.find(node => node.id === 'b')!.column).toBe(0)
    // With nobody on the left, the graph starts at its first column.
    expect(layoutGraph([{ id: 'a', label: 'a', column: 1 }, { id: 'b', label: 'b', column: 2 }], []).nodes.map(node => node.column)).toEqual([0, 1])
  })
})
