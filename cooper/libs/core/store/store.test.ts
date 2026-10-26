import { effect } from '@preact/signals-core'
import { describe, expect, test } from 'bun:test'
import { Store } from './store'

const store = () => new Store({ items: ['a'], loading: false })

describe('select', () => {
  test('follows its part of the state', () => {
    const state = store()
    const items = state.select('items')

    state.patch({ items: ['a', 'b'] })

    expect(items.value).toEqual(['a', 'b'])
  })

  test('does not notify when another part changes', () => {
    const state = store()
    const items = state.select('items')
    let runs = 0
    effect(() => {
      void items.value
      runs++
    })

    state.patch({ loading: true })

    expect(runs).toBe(1)
  })
})

describe('changes', () => {
  test('update computes the change from the current state', () => {
    const state = store()
    state.update(current => ({ items: [...current.items, 'b'] }))
    expect(state.value.items).toEqual(['a', 'b'])
  })

  test('reset goes back to the initial state', () => {
    const state = store()
    state.patch({ loading: true, items: [] })
    state.reset()
    expect(state.value).toEqual({ items: ['a'], loading: false })
  })
})
